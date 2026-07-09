// Client-side port of the pure program scheduling used by the demo shim
// (demoApi.js) so the deployed VITE_DEMO build can pause/resume/shift/edit/
// delete/start programs without a backend. This MIRRORS the server logic and
// must be kept in sync with it:
//   - server/src/programGenerator.js (generateProgramSessions, weekday math)
//   - server/src/programPresets.js   (anchorSlot)
//   - server/src/routes/plans.js     (deriveIntervalTotals)
// The real app never imports this — it hits the server. UTC date math,
// weekday convention 0=Mon..6=Sun.

const DAY_MS = 86400000;
const SESSION_COLUMNS = [
  'type', 'target_distance', 'target_duration_ms', 'target_pace_ms', 'target_rate',
  'interval_reps', 'interval_distance', 'interval_duration_ms', 'interval_rest_ms', 'notes',
];

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekdayOf(isoDate) {
  return (new Date(Date.parse(isoDate)).getUTCDay() + 6) % 7;
}

export function weekOfDate(isoDate) {
  return isoDay(Date.parse(isoDate) - weekdayOf(isoDate) * DAY_MS);
}

export function addDays(isoDate, days) {
  return isoDay(Date.parse(isoDate) + days * DAY_MS);
}

// Shift a session date by N weeks.
export function shiftDate(isoDate, weeks) {
  return addDays(isoDate, weeks * 7);
}

// Move a date to the given weekday (0=Mon..6=Sun) within its own week.
export function remapDate(isoDate, weekday) {
  return isoDay(Date.parse(weekOfDate(isoDate)) + weekday * DAY_MS);
}

export function resolveDurationWeeks(preset, requested) {
  if (preset.kind !== 'cycle') return preset.weeks.length;
  const n = Number.isInteger(requested) ? requested : preset.defaultWeeks;
  return Math.min(preset.maxWeeks, Math.max(preset.minWeeks, n));
}

function anchorSlot(preset) {
  for (let week = 0; week < preset.weeks.length; week++) {
    const slot = preset.weeks[week].sessions.findIndex(s => s.anchor === 'race_date');
    if (slot !== -1) return { week, slot };
  }
  return null;
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

// An interval session implies its own work totals; mirror the server so the
// calendar heatmap and weekly meter totals match.
export function deriveIntervalTotals(fields) {
  if (!fields.interval_reps) return fields;
  if (fields.target_distance == null && fields.interval_distance) {
    fields.target_distance = fields.interval_reps * fields.interval_distance;
  }
  if (fields.target_duration_ms == null && fields.interval_duration_ms) {
    fields.target_duration_ms = fields.interval_reps * fields.interval_duration_ms;
  }
  return fields;
}

// Light structural validation (returns error strings). The full server check
// lives in validateProgramInput; the demo only needs enough to guard the form.
export function validateProgramInput(preset, body) {
  const errors = [];
  const days = body.training_days;
  if (!Array.isArray(days) || days.length !== preset.sessionsPerWeek
      || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)
      || new Set(days).size !== days.length) {
    errors.push(`Pick ${preset.sessionsPerWeek} training days`);
  }
  if (preset.kind === 'race') {
    if (typeof body.race_date !== 'string' || Number.isNaN(Date.parse(body.race_date))) {
      errors.push('Choose a race date');
    }
  } else if (typeof body.start_date !== 'string' || Number.isNaN(Date.parse(body.start_date))) {
    errors.push('Choose a start date');
  } else if (Array.isArray(days) && days.length && !days.includes(weekdayOf(body.start_date))) {
    errors.push('start_date must fall on one of the chosen training days');
  }
  return errors;
}

export function generateProgramSessions(preset, { startDate, trainingDays, durationWeeks, raceDate }) {
  const days = [...trainingDays].sort((a, b) => a - b);
  const weeks = resolveDurationWeeks(preset, durationWeeks);

  let mondayWeek0;
  const anchor = preset.kind === 'race' ? anchorSlot(preset) : null;
  if (anchor) {
    mondayWeek0 = Date.parse(weekOfDate(raceDate)) - anchor.week * 7 * DAY_MS;
  } else {
    mondayWeek0 = Date.parse(weekOfDate(startDate));
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
      sessions.push({ ...sessionFields(session), date, program_week: week, program_slot: slot });
    }
  }

  const kept = anchor
    ? sessions.filter(s => s.date <= raceDate)
    : sessions.filter(s => s.date >= startDate);
  kept.sort((a, b) => a.date.localeCompare(b.date)
    || a.program_week - b.program_week || a.program_slot - b.program_slot);

  const effectiveStart = anchor ? (kept[0]?.date ?? raceDate) : startDate;
  return { startDate: effectiveStart, durationWeeks: weeks, sessions: kept };
}
