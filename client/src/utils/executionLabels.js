// Display labels for the observed-execution analysis (server workoutExecution.js).
// Pure/testable: value strings → human labels, plus a gate for whether a value is
// confident enough to present as a conclusion.

const INTENSITY = {
  easy: 'Easy', moderate: 'Moderate', hard: 'Hard', very_hard: 'Very hard', maximal: 'Maximal',
};
const PACING = {
  even: 'Even', negative_split: 'Negative split', mild_fade: 'Mild fade',
  significant_fade: 'Significant fade', variable: 'Variable',
};
const FINISH = { accelerated: 'Accelerated', faded: 'Faded', even: 'Even' };
const RATE = {
  stable: 'Stable',
  variable: 'Variable',
  stable_avg_variable_stroke: 'Stable average, variable stroke-to-stroke',
};
const STABILITY = { stable: 'Stable', variable: 'Variable' };
const DRIFT = { low: 'Low', moderate: 'Moderate', high: 'High' };

const MAPS = {
  intensity: INTENSITY,
  pacing: PACING,
  finish: FINISH,
  rate: RATE,
  stroke_effectiveness: STABILITY,
  hr_drift: DRIFT,
};

// Below this confidence an inferred value is not shown as a conclusion (mirrors
// the source-doc presentation rule). 'unknown' is never shown regardless.
export const MIN_SHOW_CONFIDENCE = 0.5;

// Accepting a bare value remains useful to callers that only have the category,
// while the full metric enables the more specific labels added in analysis v5.
export function execLabel(kind, metricOrValue) {
  const metric = metricOrValue && typeof metricOrValue === 'object'
    ? metricOrValue
    : { value: metricOrValue };
  const label = MAPS[kind]?.[metric.value] ?? null;
  if (!label) return null;

  if (kind === 'intensity' && metric.estimated) {
    return `Likely ${label.toLowerCase()}`;
  }

  if (kind === 'pacing') return pacingLabel(label, metric.shape);

  if (kind === 'hr_drift') {
    const drift = metric.drift_percent == null ? NaN : Number(metric.drift_percent);
    if (Number.isFinite(drift)) {
      return `${label} · ${drift > 0 ? '+' : ''}${drift.toFixed(1)}%`;
    }
  }

  return label;
}

function pacingLabel(base, shape) {
  if (!shape || typeof shape !== 'object') return base;

  const lead = shape.even_core ? 'Even core' : base;
  const details = [];

  if (shape.fast_start && shape.fast_finish) details.push('fast start and finish');
  else if (shape.fast_start) details.push('fast start');
  else if (shape.fast_finish) details.push('fast finish');

  if (shape.late_fade) details.push('late fade');
  if (details.length > 0) return `${lead} · ${details.join(' · ')}`;

  // The booleans are canonical, but tolerate a future server-provided label
  // when an analysis has no flags we recognise.
  if (typeof shape.shape_label === 'string' && shape.shape_label.trim()) {
    const fallback = shape.shape_label.trim().replaceAll('_', ' ');
    return fallback.charAt(0).toUpperCase() + fallback.slice(1);
  }

  return lead;
}

export function showsExecution(metric) {
  if (!metric || !metric.value || metric.value === 'unknown') return false;
  return (metric.confidence ?? 0) >= MIN_SHOW_CONFIDENCE;
}
