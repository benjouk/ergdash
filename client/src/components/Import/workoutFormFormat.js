// Form <-> payload marshalling for manual workout entry and result
// correction, mirroring components/Plan/planFormat.js. All string parsing
// lives here so WorkoutForm stays presentational.
import {
  parseTimeInput, formatDuration, formatPaceSeconds,
} from '../../utils/ergMath.js';

export const WORKOUT_TYPE_OPTIONS = [
  ['JustRow', 'Just row'],
  ['FixedDistanceSplits', 'Fixed distance'],
  ['FixedTimeSplits', 'Fixed time'],
  ['FixedDistanceInterval', 'Distance intervals'],
  ['FixedTimeInterval', 'Time intervals'],
  ['VariableInterval', 'Variable intervals'],
];

export const EMPTY_SPLIT = { type: 'work', distance: '', time: '', rate: '', hr: '' };

export const EMPTY_FORM = {
  date: '',
  time: '',
  workoutType: 'JustRow',
  distance: '',
  duration: '',
  rate: '',
  hrAvg: '',
  hrMax: '',
  drag: '',
  calories: '',
  comments: '',
  splits: [],
};

function localDateInput(dateStr) {
  const d = dateStr ? new Date(dateStr) : null;
  if (!d || Number.isNaN(d.getTime())) return { date: '', time: '' };
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// Prefill the form from an existing workout (Session edit mode).
export function formFromWorkout(workout) {
  return {
    ...EMPTY_FORM,
    ...localDateInput(workout.date),
    workoutType: WORKOUT_TYPE_OPTIONS.some(([value]) => value === workout.workout_type)
      ? workout.workout_type : 'JustRow',
    distance: workout.distance ? String(workout.distance) : '',
    duration: workout.time_ms ? formatDuration(workout.time_ms / 1000, 1) : '',
    rate: workout.stroke_rate ? String(workout.stroke_rate) : '',
    hrAvg: workout.heart_rate_avg ? String(workout.heart_rate_avg) : '',
    hrMax: workout.heart_rate_max ? String(workout.heart_rate_max) : '',
    drag: workout.drag_factor ? String(workout.drag_factor) : '',
    calories: workout.calories ? String(workout.calories) : '',
    comments: workout.comments || '',
    splits: [], // splits editing applies to new entries only
  };
}

function parseOptionalInt(value, field, min, max, errors) {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const n = Math.round(Number(text));
  if (!Number.isFinite(n) || n < min || n > max) {
    errors.push(`${field} must be between ${min} and ${max}`);
    return null;
  }
  return n;
}

// Turn form fields into a POST/PATCH payload. Returns { payload, error }.
export function formToPayload(form) {
  const errors = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
    return { payload: null, error: 'Set a date' };
  }
  const time = /^\d{2}:\d{2}$/.test(form.time) ? form.time : '00:00';
  const date = `${form.date} ${time}:00`;

  const distance = Math.round(Number(form.distance));
  if (!(distance > 0)) {
    return { payload: null, error: 'Set the distance in meters' };
  }

  const durationS = parseTimeInput(form.duration);
  if (!durationS) {
    return { payload: null, error: 'Set the time (e.g. 36:40 or 7:12.5)' };
  }

  const payload = {
    date,
    workout_type: form.workoutType,
    distance,
    time_ms: Math.round(durationS * 1000),
    stroke_rate: (() => {
      const text = String(form.rate ?? '').trim();
      if (text === '') return null;
      const n = Number(text);
      if (!Number.isFinite(n) || n < 10 || n > 60) {
        errors.push('rate must be between 10 and 60');
        return null;
      }
      return n;
    })(),
    heart_rate_avg: parseOptionalInt(form.hrAvg, 'avg HR', 20, 250, errors),
    heart_rate_max: parseOptionalInt(form.hrMax, 'max HR', 20, 250, errors),
    drag_factor: parseOptionalInt(form.drag, 'drag factor', 60, 250, errors),
    calories: parseOptionalInt(form.calories, 'calories', 0, 100000, errors),
    comments: form.comments.trim() || null,
  };

  if (errors.length > 0) {
    return { payload: null, error: errors[0] };
  }

  if (form.splits.length > 0) {
    const intervals = [];
    for (let i = 0; i < form.splits.length; i++) {
      const split = form.splits[i];
      const splitDistance = Math.round(Number(split.distance)) || 0;
      const splitTimeS = parseTimeInput(split.time);
      if (split.type === 'work' && !splitDistance && !splitTimeS) {
        return { payload: null, error: `Split ${i + 1} needs a distance or time` };
      }
      const splitErrors = [];
      intervals.push({
        type: split.type === 'rest' ? 'rest' : 'work',
        distance: splitDistance,
        time_ms: splitTimeS ? Math.round(splitTimeS * 1000) : null,
        stroke_rate: (() => {
          const n = Number(String(split.rate ?? '').trim());
          return Number.isFinite(n) && n >= 10 && n <= 60 ? n : null;
        })(),
        heart_rate_avg: parseOptionalInt(split.hr, `split ${i + 1} HR`, 20, 250, splitErrors),
      });
      if (splitErrors.length > 0) {
        return { payload: null, error: splitErrors[0] };
      }
    }
    payload.intervals = intervals;
  }

  return { payload, error: null };
}

// The subset of payload fields that differ from the stored workout - PATCH
// sends only these so edited_fields stays minimal on c2 rows.
export function diffPayload(payload, workout) {
  const diff = {};
  const comparable = {
    date: workout.date ? payload.date?.slice(0, 16) !== String(workout.date).replace('T', ' ').slice(0, 16) : true,
    workout_type: payload.workout_type !== workout.workout_type,
    distance: payload.distance !== workout.distance,
    time_ms: payload.time_ms !== workout.time_ms,
    stroke_rate: (payload.stroke_rate ?? null) !== (workout.stroke_rate ?? null),
    heart_rate_avg: (payload.heart_rate_avg ?? null) !== (workout.heart_rate_avg ?? null),
    heart_rate_max: (payload.heart_rate_max ?? null) !== (workout.heart_rate_max ?? null),
    drag_factor: (payload.drag_factor ?? null) !== (workout.drag_factor ?? null),
    calories: (payload.calories ?? null) !== (workout.calories ?? null),
    comments: (payload.comments ?? null) !== (workout.comments ?? null),
  };
  for (const [field, changed] of Object.entries(comparable)) {
    if (changed && payload[field] !== undefined) diff[field] = payload[field];
  }
  return diff;
}

// Live pace preview for the form footer.
export function formPacePreview(form) {
  const distance = Math.round(Number(form.distance));
  const durationS = parseTimeInput(form.duration);
  if (!(distance > 0) || !durationS) return null;
  return formatPaceSeconds((durationS / distance) * 500);
}

// Running totals of work splits vs the workout header, for the Σ warning.
export function splitTotals(form) {
  const work = form.splits.filter(split => split.type !== 'rest');
  const distance = work.reduce((sum, split) => sum + (Math.round(Number(split.distance)) || 0), 0);
  const timeS = work.reduce((sum, split) => sum + (parseTimeInput(split.time) || 0), 0);
  return { distance, timeS };
}
