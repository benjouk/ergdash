import { describe, expect, it } from 'vitest';
import { isIntervalWorkoutType, WORKOUT_TYPES } from '../src/workoutTypes.js';

describe('workout type helpers', () => {
  it('keeps interval-type detection shared for no-rest interval workouts', () => {
    expect(isIntervalWorkoutType('VariableInterval')).toBe(true);
    expect(isIntervalWorkoutType('VariableIntervalUndefinedRest')).toBe(true);
    expect(isIntervalWorkoutType('FixedDistanceSplits')).toBe(false);
  });

  it('accepts both observed FixedWattMinute spellings in manual edits', () => {
    expect(WORKOUT_TYPES).toContain('FixedWattMinute');
    expect(WORKOUT_TYPES).toContain('FixedWattMinutes');
  });
});
