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
const STABILITY = { stable: 'Stable', variable: 'Variable' };

const MAPS = {
  intensity: INTENSITY,
  pacing: PACING,
  finish: FINISH,
  rate: STABILITY,
  stroke_effectiveness: STABILITY,
};

// Below this confidence an inferred value is not shown as a conclusion (mirrors
// the source-doc presentation rule). 'unknown' is never shown regardless.
export const MIN_SHOW_CONFIDENCE = 0.5;

export function execLabel(kind, value) {
  return MAPS[kind]?.[value] ?? null;
}

export function showsExecution(metric) {
  if (!metric || !metric.value || metric.value === 'unknown') return false;
  return (metric.confidence ?? 0) >= MIN_SHOW_CONFIDENCE;
}
