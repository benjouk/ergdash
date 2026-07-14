// Pure schedule generation for training programs. No DB access - takes a
// preset (from programPresets.js) plus the user's choices and returns the
// planned_workouts rows to insert. UTC date math, weekday convention
// 0=Monday..6=Sunday (matches the client's planCalendar ordering).
import { anchorSlot } from './programPresets.js';

const DAY_MS = 86400000;
const SESSION_COLUMNS = [
  'type', 'target_distance', 'target_duration_ms', 'target_pace_ms', 'target_rate',
  'interval_reps', 'interval_distance', 'interval_duration_ms', 'interval_rest_ms', 'notes',
];

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Monday-based weekday index (0=Mon .. 6=Sun) for an ISO date.
export function weekdayOf(isoDate) {
  return (new Date(Date.parse(isoDate)).getUTCDay() + 6) % 7;
}

// The Monday (as an ISO date) of the week containing isoDate.
export function weekOfDate(isoDate) {
  return isoDay(Date.parse(isoDate) - weekdayOf(isoDate) * DAY_MS);
}

// The first date on/after isoDate whose weekday is `weekday` (0=Mon..6=Sun).
// Used to roll a chosen start forward to the earliest training day so a
// program always begins on a clean week-1, session-1 rather than joining a
// calendar week partway through.
export function alignStart(isoDate, weekday) {
  const offset = (weekday - weekdayOf(isoDate) + 7) % 7;
  return isoDay(Date.parse(isoDate) + offset * DAY_MS);
}

// Duration in weeks: cycle presets let the user choose (clamped); fixed and
// race presets are exactly their template length.
export function resolveDurationWeeks(preset, requested) {
  if (preset.kind !== 'cycle') return preset.weeks.length;
  const n = Number.isInteger(requested) ? requested : preset.defaultWeeks;
  return Math.min(preset.maxWeeks, Math.max(preset.minWeeks, n));
}

function templateWeek(preset, weekIndex) {
  return preset.kind === 'cycle'
    ? preset.weeks[weekIndex % preset.cycleWeeks]
    : preset.weeks[weekIndex];
}

function sessionFields(session) {
  const row = {};
  for (const col of SESSION_COLUMNS) row[col] = session[col] ?? null;
  return row; // `anchor` is deliberately dropped.
}

// Validate the user's program request against a preset. Returns a list of
// human-readable errors (empty when valid). Structural only - today-relative
// checks (e.g. race not too soon) live in the route.
export function validateProgramInput(preset, body) {
  const errors = [];

  const days = body.training_days;
  if (!Array.isArray(days)
      || days.length !== preset.sessionsPerWeek
      || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)
      || new Set(days).size !== days.length) {
    errors.push(`training_days must be ${preset.sessionsPerWeek} unique weekday integers (0=Mon..6=Sun)`);
  }

  if (preset.kind === 'race') {
    if (typeof body.race_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.race_date)
        || Number.isNaN(Date.parse(body.race_date))) {
      errors.push('race_date must be an ISO 8601 date (YYYY-MM-DD)');
    }
  } else if (typeof body.start_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)
      || Number.isNaN(Date.parse(body.start_date))) {
    // The start rolls forward to the first training day, so it need only be a
    // valid date - it doesn't have to fall on a chosen training day.
    errors.push('start_date must be an ISO 8601 date (YYYY-MM-DD)');
  }

  if (preset.kind === 'cycle' && body.duration_weeks != null) {
    if (!Number.isInteger(body.duration_weeks)
        || body.duration_weeks < preset.minWeeks || body.duration_weeks > preset.maxWeeks) {
      errors.push(`duration_weeks must be an integer between ${preset.minWeeks} and ${preset.maxWeeks}`);
    }
  }

  return errors;
}

// Generate the session rows for a program. Assumes inputs already validated.
// Returns { startDate, durationWeeks, sessions } where each session carries
// its date, program_week, program_slot and the planned_workouts columns.
// Interval totals are left to the caller (deriveIntervalTotals) so the reps
// stay the single source of truth.
export function generateProgramSessions(preset, { startDate, trainingDays, durationWeeks, raceDate }) {
  const days = [...trainingDays].sort((a, b) => a - b);
  const weeks = resolveDurationWeeks(preset, durationWeeks);

  // Anchor the week-0 Monday. For race presets, work backwards from the race
  // date so the anchored session lands exactly on it. Otherwise roll the
  // chosen start forward to the earliest training day (slot 0) so week 0 is a
  // full, clean cycle-week 1 - a mid-week start never skips earlier sessions.
  let mondayWeek0;
  const anchor = preset.kind === 'race' ? anchorSlot(preset) : null;
  const alignedStart = anchor ? null : alignStart(startDate, days[0]);
  if (anchor) {
    mondayWeek0 = Date.parse(weekOfDate(raceDate)) - anchor.week * 7 * DAY_MS;
  } else {
    mondayWeek0 = Date.parse(weekOfDate(alignedStart));
  }

  const sessions = [];
  for (let week = 0; week < weeks; week++) {
    const tmpl = templateWeek(preset, week);
    for (let slot = 0; slot < days.length; slot++) {
      const session = tmpl.sessions[slot];
      const isAnchor = anchor && anchor.week === week
        && tmpl.sessions[slot]?.anchor === 'race_date';
      const date = isAnchor
        ? raceDate
        : isoDay(mondayWeek0 + (week * 7 + days[slot]) * DAY_MS);

      sessions.push({
        ...sessionFields(session),
        date,
        program_week: week,
        program_slot: slot,
      });
    }
  }

  // Race presets drop anything the schedule would place after race day.
  // Non-race presets need no trimming: week 0 starts exactly on slot 0
  // (alignedStart), so every generated session is on/after the start.
  const kept = anchor
    ? sessions.filter(s => s.date <= raceDate)
    : sessions;
  kept.sort((a, b) => a.date.localeCompare(b.date)
    || a.program_week - b.program_week || a.program_slot - b.program_slot);

  const effectiveStart = anchor ? (kept[0]?.date ?? raceDate) : alignedStart;
  return { startDate: effectiveStart, durationWeeks: weeks, sessions: kept };
}
