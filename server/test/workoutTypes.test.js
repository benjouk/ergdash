import { describe, expect, it } from 'vitest';
import {
  isIntervalWorkoutType,
  isContinuousWorkoutType,
  workoutSubtype,
  WORKOUT_TYPES,
} from '../src/workoutTypes.js';

describe('workout type helpers', () => {
  it('keeps interval-type detection shared for no-rest interval workouts', () => {
    expect(isIntervalWorkoutType('VariableInterval')).toBe(true);
    expect(isIntervalWorkoutType('VariableIntervalUndefinedRest')).toBe(true);
    expect(isIntervalWorkoutType('FixedDistanceSplits')).toBe(false);
  });

  it('detects continuous types and excludes interval/unknown types', () => {
    expect(isContinuousWorkoutType('FixedDistanceSplits')).toBe(true);
    expect(isContinuousWorkoutType('JustRow')).toBe(true);
    expect(isContinuousWorkoutType('VariableInterval')).toBe(false);
    expect(isContinuousWorkoutType('unknown')).toBe(false);
  });

  it('maps workout types to a session-format subtype', () => {
    expect(workoutSubtype('FixedDistanceSplits')).toBe('fixed_distance');
    expect(workoutSubtype('FixedTimeInterval')).toBe('fixed_time');
    expect(workoutSubtype('VariableInterval')).toBe('variable');
    expect(workoutSubtype('JustRow')).toBe('unknown');
    expect(workoutSubtype('unknown')).toBe('unknown');
  });

  it('accepts both observed FixedWattMinute spellings in manual edits', () => {
    expect(WORKOUT_TYPES).toContain('FixedWattMinute');
    expect(WORKOUT_TYPES).toContain('FixedWattMinutes');
  });
});
