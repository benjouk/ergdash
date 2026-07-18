// Session purpose options for the one-tap intent tag on the session page.
// Values mirror the server's WORKOUT_INTENTS (workouts.intent); null means
// untagged. Warm-ups keep counting toward volume but are excluded from
// trends, session mix, PBs, and race projections server-side.
export const INTENT_OPTIONS = [
  { value: 'warmup', label: 'Warm-up' },
  { value: 'steady', label: 'Steady' },
  { value: 'test', label: 'Test' },
  { value: 'race', label: 'Race' },
];

export function intentLabel(value) {
  return INTENT_OPTIONS.find(o => o.value === value)?.label || null;
}
