// Shared Plan-view helpers: session summaries, the add/edit form shape, and
// form<->payload marshalling. Interval totals are intentionally NOT derived
// here — the server owns that (deriveIntervalTotals / mergeIntervalPatch in
// server/src/routes/plans.js), so the client just sends the raw interval spec.
import {
  parsePaceInput, parseTimeInput, formatPaceSeconds, formatDuration,
} from '../../utils/ergMath.js';

export const PLAN_TYPES = [
  ['steady', 'Steady'],
  ['intervals', 'Intervals'],
  ['test', 'Test'],
  ['race', 'Race'],
  ['other', 'Other'],
];

export const PLAN_TYPE_LABELS = Object.fromEntries(PLAN_TYPES);

// Common erg sessions (Pete Plan staples and standard tests) to prefill the
// form. Values are form-shaped, not payload-shaped.
export const SESSION_PRESETS = [
  { label: '2k test', form: { type: 'test', distance: '2000' } },
  { label: '5k test', form: { type: 'test', distance: '5000' } },
  { label: '10k steady', form: { type: 'steady', distance: '10000' } },
  { label: '30:00 steady', form: { type: 'steady', duration: '30:00' } },
  { label: '60:00 steady', form: { type: 'steady', duration: '60:00' } },
  { label: '8×500m / 3:30r', form: { type: 'intervals', reps: '8', repDistance: '500', rest: '3:30' } },
  { label: '4×1000m / 5:00r', form: { type: 'intervals', reps: '4', repDistance: '1000', rest: '5:00' } },
  { label: '5×1500m / 5:00r', form: { type: 'intervals', reps: '5', repDistance: '1500', rest: '5:00' } },
  { label: '4×2000m / 5:00r', form: { type: 'intervals', reps: '4', repDistance: '2000', rest: '5:00' } },
  { label: '3×2500m / 5:00r', form: { type: 'intervals', reps: '3', repDistance: '2500', rest: '5:00' } },
  { label: '4×10:00 / 2:00r', form: { type: 'intervals', reps: '4', repDuration: '10:00', rest: '2:00' } },
];

export const REPEAT_OPTIONS = [
  ['0', 'Just this week'],
  ['1', 'Next 2 weeks'],
  ['3', 'Next 4 weeks'],
  ['5', 'Next 6 weeks'],
  ['7', 'Next 8 weeks'],
  ['11', 'Next 12 weeks'],
];

export const EMPTY_FORM = {
  type: 'steady', distance: '', duration: '',
  reps: '', repDistance: '', repDuration: '', rest: '',
  pace: '', rate: '', notes: '', repeat: '0',
};

// Short human summary of a plan's target ("4×2000m / 5:00r", "10km", "30:00").
export function planSummary(plan, formatDistance) {
  if (plan.interval_reps) {
    const work = plan.interval_distance
      ? formatDistance(plan.interval_distance)
      : formatDuration(plan.interval_duration_ms / 1000, 0);
    const rest = plan.interval_rest_ms
      ? ` / ${formatDuration(plan.interval_rest_ms / 1000, 0)}r`
      : '';
    return `${plan.interval_reps}×${work}${rest}`;
  }
  if (plan.target_distance) return formatDistance(plan.target_distance);
  if (plan.target_duration_ms) return formatDuration(plan.target_duration_ms / 1000, 0);
  return plan.type;
}

// The single adherence state that best summarises a day's plans, for
// one-marker-per-day displays. Missed outranks everything (it needs
// attention); skipped only wins when it's all there is.
export function dominantAdherence(plans) {
  for (const state of ['missed', 'planned', 'completed', 'skipped']) {
    if (plans.some(p => p.adherence === state)) return state;
  }
  return null;
}

// Weekly totals for a list of ISO dates, from the maps Plan.jsx derives.
export function weekTotals(days, plansByDay, metersByDay) {
  let plannedMeters = 0;
  let rowedMeters = 0;
  let sessionsTotal = 0;
  let sessionsDone = 0;
  for (const day of days) {
    for (const p of plansByDay.get(day) || []) {
      sessionsTotal += 1;
      if (p.adherence === 'completed') sessionsDone += 1;
      plannedMeters += p.target_distance || 0;
    }
    const entry = metersByDay.map.get(day);
    if (entry) rowedMeters += entry.meters;
  }
  return { plannedMeters, rowedMeters, sessionsTotal, sessionsDone };
}

export function formFromPlan(plan) {
  return {
    type: plan.type,
    distance: plan.target_distance && !plan.interval_reps ? String(plan.target_distance) : '',
    duration: plan.target_duration_ms && !plan.interval_reps ? formatDuration(plan.target_duration_ms / 1000, 0) : '',
    reps: plan.interval_reps ? String(plan.interval_reps) : '',
    repDistance: plan.interval_distance ? String(plan.interval_distance) : '',
    repDuration: plan.interval_duration_ms ? formatDuration(plan.interval_duration_ms / 1000, 0) : '',
    rest: plan.interval_rest_ms ? formatDuration(plan.interval_rest_ms / 1000, 0) : '',
    pace: plan.target_pace_ms ? formatPaceSeconds(plan.target_pace_ms / 1000) : '',
    rate: plan.target_rate ? String(plan.target_rate) : '',
    notes: plan.notes || '',
    repeat: '0',
  };
}

// Turn form fields into an API payload. Returns { payload, error }; error is a
// user-facing string when the form is incomplete. Does not derive interval
// totals — the server recomputes those from the interval spec.
export function formToPayload(form) {
  const payload = { type: form.type };

  const reps = Math.round(Number(form.reps));
  if (form.type === 'intervals' && reps > 0) {
    const repDistance = Math.round(Number(form.repDistance));
    const repDurationS = parseTimeInput(form.repDuration);
    if (!(repDistance > 0) && !repDurationS) {
      return { payload: null, error: 'Set a rep distance or rep time' };
    }
    const restS = parseTimeInput(form.rest);
    payload.interval_reps = reps;
    payload.interval_distance = repDistance > 0 ? repDistance : null;
    payload.interval_duration_ms = repDurationS ? Math.round(repDurationS * 1000) : null;
    payload.interval_rest_ms = restS ? Math.round(restS * 1000) : null;
    // Totals are left to the server: omit target_distance/target_duration_ms
    // entirely so deriveIntervalTotals (POST) and mergeIntervalPatch (PATCH,
    // which only recomputes when the key is absent) fill them from the reps.
  } else {
    payload.interval_reps = null;
    payload.interval_distance = null;
    payload.interval_duration_ms = null;
    payload.interval_rest_ms = null;

    const distance = Math.round(Number(form.distance));
    payload.target_distance = Number.isFinite(distance) && distance > 0 ? distance : null;

    const durationS = parseTimeInput(form.duration);
    payload.target_duration_ms = durationS ? Math.round(durationS * 1000) : null;

    if (!payload.target_distance && !payload.target_duration_ms) {
      return { payload: null, error: 'Set a target distance or duration' };
    }
  }

  const paceS = parsePaceInput(form.pace);
  payload.target_pace_ms = paceS ? Math.round(paceS * 1000) : null;

  const rate = Math.round(Number(form.rate));
  payload.target_rate = Number.isFinite(rate) && rate > 0 ? rate : null;

  payload.notes = form.notes.trim() || null;

  return { payload, error: null };
}
