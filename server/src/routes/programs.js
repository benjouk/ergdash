import { Router } from 'express';
import { getDb } from '../db.js';
import { deriveIntervalTotals, adherenceOf } from './plans.js';
import { autoMatchPlan } from '../planMatching.js';
import { PROGRAM_PRESETS, getPreset } from '../programPresets.js';
import {
  generateProgramSessions, validateProgramInput, resolveDurationWeeks, weekOfDate,
} from '../programGenerator.js';

const router = Router();
const DAY_MS = 86400000;
const RACE_MIN_LEAD_DAYS = 14;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function getProgram(db, id) {
  return db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
}

// Decorate a program row with its parsed training days and computed progress
// (per-week and overall adherence counts). Progress is derived from the
// generated planned_workouts rows, never stored.
function decorateProgram(db, program, todayStr = today()) {
  const rows = db.prepare(
    'SELECT * FROM planned_workouts WHERE program_id = ? ORDER BY date, program_week, program_slot'
  ).all(program.id);

  const totals = { total: 0, completed: 0, skipped: 0, missed: 0, upcoming: 0 };
  const weekMap = new Map();
  for (const row of rows) {
    const adherence = adherenceOf(row, todayStr);
    totals.total += 1;
    if (adherence === 'completed') totals.completed += 1;
    else if (adherence === 'skipped') totals.skipped += 1;
    else if (adherence === 'missed') totals.missed += 1;
    else totals.upcoming += 1; // 'planned'

    const w = row.program_week;
    if (!weekMap.has(w)) {
      weekMap.set(w, { week: w, from: row.date, to: row.date, total: 0, completed: 0, skipped: 0, missed: 0 });
    }
    const wk = weekMap.get(w);
    if (row.date < wk.from) wk.from = row.date;
    if (row.date > wk.to) wk.to = row.date;
    wk.total += 1;
    if (adherence === 'completed') wk.completed += 1;
    else if (adherence === 'skipped') wk.skipped += 1;
    else if (adherence === 'missed') wk.missed += 1;
  }

  const weeks = [...weekMap.values()].sort((a, b) => a.week - b.week);
  // Current week: the latest week already under way, clamped to the program.
  let currentWeek = 0;
  for (const wk of weeks) if (todayStr >= wk.from) currentWeek = wk.week;
  currentWeek = Math.min(currentWeek, program.duration_weeks - 1);

  return {
    id: program.id,
    preset_id: program.preset_id,
    name: program.name,
    start_date: program.start_date,
    duration_weeks: program.duration_weeks,
    training_days: JSON.parse(program.training_days),
    race_date: program.race_date,
    status: program.status,
    paused_at: program.paused_at,
    created_at: program.created_at,
    progress: { current_week: currentWeek, total_weeks: program.duration_weeks, sessions: totals, weeks },
  };
}

// Preset catalogue (full definitions, including week-by-week sessions).
router.get('/presets', (req, res) => {
  res.json({ presets: PROGRAM_PRESETS });
});

router.get('/', (req, res) => {
  const db = getDb();
  const todayStr = today();
  const programs = db.prepare('SELECT * FROM programs ORDER BY created_at DESC, id DESC').all();
  res.json({ programs: programs.map(p => decorateProgram(db, p, todayStr)) });
});

const SESSION_INSERT = `
  INSERT INTO planned_workouts (
    date, type, target_distance, target_duration_ms, target_pace_ms, target_rate,
    interval_reps, interval_distance, interval_duration_ms, interval_rest_ms, notes,
    program_id, program_week, program_slot
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

router.post('/', (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const todayStr = today();

  const preset = getPreset(body.preset_id);
  if (!preset) {
    return res.status(400).json({ error: 'Validation failed', details: ['Unknown preset_id'] });
  }

  const errors = validateProgramInput(preset, body);
  if (preset.kind === 'race' && typeof body.race_date === 'string' && !errors.length) {
    const lead = (Date.parse(body.race_date) - Date.parse(todayStr)) / DAY_MS;
    if (lead < RACE_MIN_LEAD_DAYS) {
      errors.push(`race_date must be at least ${RACE_MIN_LEAD_DAYS / 7} weeks away`);
    }
  }
  if (errors.length) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  // One active-or-paused program at a time keeps "the current program"
  // unambiguous; finishing means deleting it.
  const inProgress = db.prepare("SELECT id FROM programs WHERE status IN ('active','paused')").get();
  if (inProgress) {
    return res.status(409).json({ error: 'A program is already in progress. Delete it before starting another.' });
  }

  const trainingDays = [...body.training_days].sort((a, b) => a - b);
  const durationWeeks = resolveDurationWeeks(preset, body.duration_weeks);
  const gen = generateProgramSessions(preset, {
    startDate: body.start_date, trainingDays, durationWeeks, raceDate: body.race_date,
  });

  const insertProgram = db.prepare(`
    INSERT INTO programs (preset_id, name, start_date, duration_weeks, training_days, race_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertSession = db.prepare(SESSION_INSERT);

  const sessionIds = [];
  const programId = db.transaction(() => {
    const pid = insertProgram.run(
      preset.id, preset.name, gen.startDate, gen.durationWeeks,
      JSON.stringify(trainingDays), body.race_date ?? null,
    ).lastInsertRowid;

    for (const s of gen.sessions) {
      const f = deriveIntervalTotals({ ...s });
      sessionIds.push(insertSession.run(
        s.date, s.type, f.target_distance ?? null, f.target_duration_ms ?? null,
        s.target_pace_ms ?? null, s.target_rate ?? null,
        s.interval_reps ?? null, s.interval_distance ?? null,
        s.interval_duration_ms ?? null, s.interval_rest_ms ?? null, s.notes ?? null,
        pid, s.program_week, s.program_slot,
      ).lastInsertRowid);
    }
    return pid;
  })();

  // Sessions dated today or earlier may already have a matching synced workout.
  for (const id of sessionIds) {
    const row = db.prepare('SELECT date FROM planned_workouts WHERE id = ?').get(id);
    if (row && row.date <= todayStr) autoMatchPlan(id);
  }

  res.status(201).json(decorateProgram(db, getProgram(db, programId), todayStr));
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid program id' });

  const program = getProgram(db, id);
  if (!program) return res.status(404).json({ error: 'Program not found' });

  const body = req.body || {};
  const todayStr = today();

  if (body.status !== undefined) {
    if (!['active', 'paused'].includes(body.status)) {
      return res.status(400).json({ error: 'Validation failed', details: ['status must be active or paused'] });
    }
    if (body.status === 'paused' && program.status === 'active') {
      db.prepare("UPDATE programs SET status = 'paused', paused_at = ?, updated_at = datetime('now') WHERE id = ?")
        .run(todayStr, id);
    } else if (body.status === 'active' && program.status === 'paused') {
      // Resume: push future sessions (and any that fell due during the pause)
      // forward by however many whole weeks the pause spanned.
      const elapsedDays = Math.max(0, (Date.parse(todayStr) - Date.parse(program.paused_at)) / DAY_MS);
      const weeks = Math.ceil(elapsedDays / 7);
      db.transaction(() => {
        if (weeks > 0) {
          db.prepare(`
            UPDATE planned_workouts SET date = date(date, ?), updated_at = datetime('now')
            WHERE program_id = ? AND status = 'planned' AND date >= ?
          `).run(`+${weeks * 7} days`, id, program.paused_at);
        }
        db.prepare("UPDATE programs SET status = 'active', paused_at = NULL, updated_at = datetime('now') WHERE id = ?")
          .run(id);
      })();
    }
  } else if (body.training_days !== undefined) {
    const preset = getPreset(program.preset_id);
    const days = body.training_days;
    if (!Array.isArray(days) || days.length !== (preset?.sessionsPerWeek ?? -1)
        || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)
        || new Set(days).size !== days.length) {
      return res.status(400).json({
        error: 'Validation failed',
        details: [`training_days must be ${preset?.sessionsPerWeek ?? '?'} unique weekday integers (0=Mon..6=Sun)`],
      });
    }
    const sorted = [...days].sort((a, b) => a - b);
    // Remap each future planned session to its slot's new weekday within the
    // same Monday-anchored week. Completed/past rows are frozen.
    const rows = db.prepare(
      "SELECT id, date, program_slot FROM planned_workouts WHERE program_id = ? AND status = 'planned' AND date >= ?"
    ).all(id, todayStr);
    const remapped = [];
    db.transaction(() => {
      for (const row of rows) {
        const newDate = isoDay(Date.parse(weekOfDate(row.date)) + sorted[row.program_slot] * DAY_MS);
        if (newDate !== row.date) {
          db.prepare("UPDATE planned_workouts SET date = ?, updated_at = datetime('now') WHERE id = ?")
            .run(newDate, row.id);
          remapped.push({ id: row.id, date: newDate });
        }
      }
      db.prepare("UPDATE programs SET training_days = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(sorted), id);
    })();
    // A remap can pull a session onto today or earlier; try to match those.
    for (const r of remapped) if (r.date <= todayStr) autoMatchPlan(r.id);
  } else {
    return res.status(400).json({ error: 'No supported fields (status or training_days)' });
  }

  res.json(decorateProgram(db, getProgram(db, id), todayStr));
});

router.post('/:id/shift', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid program id' });

  const weeks = Number(req.body?.weeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8) {
    return res.status(400).json({ error: 'Validation failed', details: ['weeks must be an integer between 1 and 8'] });
  }

  const program = getProgram(db, id);
  if (!program) return res.status(404).json({ error: 'Program not found' });

  const todayStr = today();
  db.transaction(() => {
    db.prepare(`
      UPDATE planned_workouts SET date = date(date, ?), updated_at = datetime('now')
      WHERE program_id = ? AND status = 'planned' AND date >= ?
    `).run(`+${weeks * 7} days`, id, todayStr);
    db.prepare("UPDATE programs SET updated_at = datetime('now') WHERE id = ?").run(id);
  })();

  res.json(decorateProgram(db, getProgram(db, id), todayStr));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid program id' });

  const program = getProgram(db, id);
  if (!program) return res.status(404).json({ error: 'Program not found' });

  const todayStr = today();
  db.transaction(() => {
    // Drop only the untouched future sessions; completed/skipped/past rows
    // survive with program_id nulled by the FK (ON DELETE SET NULL).
    db.prepare("DELETE FROM planned_workouts WHERE program_id = ? AND status = 'planned' AND date >= ?")
      .run(id, todayStr);
    db.prepare('DELETE FROM programs WHERE id = ?').run(id);
  })();

  res.json({ ok: true });
});

export default router;
