export const INTERVAL_WORKOUT_TYPES = new Set([
  'FixedDistanceInterval',
  'FixedTimeInterval',
  'FixedCalorieInterval',
  'FixedWattMinuteInterval',
  'VariableInterval',
  'VariableIntervalUndefinedRest',
]);

export const CONTINUOUS_WORKOUT_TYPES = new Set([
  'JustRow',
  'FixedDistanceSplits',
  'FixedTimeSplits',
  'FixedCalorie',
  'FixedWattMinute',
  'FixedWattMinutes',
]);

export const WORKOUT_TYPES = [
  ...CONTINUOUS_WORKOUT_TYPES,
  ...INTERVAL_WORKOUT_TYPES,
  'unknown',
];

// Interval subtype for a Concept2 workout type, describing the session format
// (not intensity). 'unknown' covers open pieces (JustRow) and unrecognized types.
const SUBTYPE_BY_TYPE = {
  FixedDistanceSplits: 'fixed_distance',
  FixedDistanceInterval: 'fixed_distance',
  FixedTimeSplits: 'fixed_time',
  FixedTimeInterval: 'fixed_time',
  FixedCalorie: 'fixed_calorie',
  FixedCalorieInterval: 'fixed_calorie',
  FixedWattMinute: 'fixed_watt_minute',
  FixedWattMinutes: 'fixed_watt_minute',
  FixedWattMinuteInterval: 'fixed_watt_minute',
  VariableInterval: 'variable',
  VariableIntervalUndefinedRest: 'variable',
};

export function isIntervalWorkoutType(workoutType) {
  return INTERVAL_WORKOUT_TYPES.has(workoutType);
}

export function isContinuousWorkoutType(workoutType) {
  return CONTINUOUS_WORKOUT_TYPES.has(workoutType);
}

export function workoutSubtype(workoutType) {
  return SUBTYPE_BY_TYPE[workoutType] || 'unknown';
}
