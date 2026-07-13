export const INTERVAL_WORKOUT_TYPES = new Set([
  'FixedDistanceInterval',
  'FixedTimeInterval',
  'FixedCalorieInterval',
  'FixedWattMinuteInterval',
  'VariableInterval',
  'VariableIntervalUndefinedRest',
]);

export const WORKOUT_TYPES = [
  'JustRow',
  'FixedDistanceSplits',
  'FixedTimeSplits',
  'FixedCalorie',
  'FixedWattMinute',
  'FixedWattMinutes',
  ...INTERVAL_WORKOUT_TYPES,
  'unknown',
];

export function isIntervalWorkoutType(workoutType) {
  return INTERVAL_WORKOUT_TYPES.has(workoutType);
}
