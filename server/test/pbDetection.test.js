import { describe, expect, it } from 'vitest';
import { computePbProgression } from '../src/pbDetection.js';

describe('computePbProgression', () => {
  it('counts the first workout at a standard distance as a PB', () => {
    const events = computePbProgression([
      workout({ id: 1, distance: 2000, pace_ms: 120000 }),
    ]);

    expect(events).toEqual([
      expect.objectContaining({ workout_id: 1, distance: 2000, pace_ms: 120000 }),
    ]);
  });

  it('detects improvements at the same distance', () => {
    const events = computePbProgression([
      workout({ id: 1, distance: 2000, pace_ms: 120000 }),
      workout({ id: 2, distance: 2000, pace_ms: 119000 }),
    ]);

    expect(events.map(event => event.workout_id)).toEqual([1, 2]);
  });

  it('ignores slower workouts after a PB', () => {
    const events = computePbProgression([
      workout({ id: 1, distance: 2000, pace_ms: 120000 }),
      workout({ id: 2, distance: 2000, pace_ms: 121000 }),
      workout({ id: 3, distance: 2000, pace_ms: 119000 }),
    ]);

    expect(events.map(event => event.workout_id)).toEqual([1, 3]);
  });

  it('ignores non-standard distances and invalid paces', () => {
    const events = computePbProgression([
      workout({ id: 1, distance: 1500, pace_ms: 110000 }),
      workout({ id: 2, distance: 2000, pace_ms: 0 }),
      workout({ id: 3, distance: 2000, pace_ms: null }),
    ]);

    expect(events).toEqual([]);
  });

  it('tracks multiple distances independently', () => {
    const events = computePbProgression([
      workout({ id: 1, distance: 2000, pace_ms: 120000 }),
      workout({ id: 2, distance: 5000, pace_ms: 130000 }),
      workout({ id: 3, distance: 2000, pace_ms: 121000 }),
      workout({ id: 4, distance: 5000, pace_ms: 129000 }),
      workout({ id: 5, distance: 2000, pace_ms: 119000 }),
    ]);

    expect(events.map(event => [event.workout_id, event.distance])).toEqual([
      [1, 2000],
      [2, 5000],
      [4, 5000],
      [5, 2000],
    ]);
  });
});

function workout(overrides) {
  return {
    id: 1,
    date: '2024-01-01T00:00:00.000Z',
    distance: 2000,
    pace_ms: 120000,
    time_ms: 480000,
    ...overrides,
  };
}
