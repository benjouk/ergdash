import { describe, expect, it } from 'vitest';
import { isNearDistance } from './SoloRaceReplay.jsx';

describe('isNearDistance (PB matching for solo race)', () => {
  it('matches a session a few metres past the scored line to its standard PB', () => {
    // The reported bug: a 2,006m row could not race the 2,000m PB because the
    // lookup demanded an exact metre count.
    expect(isNearDistance(2000, 2006)).toBe(true);
    expect(isNearDistance(2000, 2000)).toBe(true);
    expect(isNearDistance(2000, 1995)).toBe(true);
  });

  it('keeps the widely spaced standard distances from conflating', () => {
    expect(isNearDistance(2000, 1000)).toBe(false);
    expect(isNearDistance(2000, 5000)).toBe(false);
    expect(isNearDistance(1000, 2006)).toBe(false);
    // The 5% edges of the 2k band mirror the Workouts 1,900-2,100m filter.
    expect(isNearDistance(2000, 2100)).toBe(true);
    expect(isNearDistance(2000, 2101)).toBe(false);
  });

  it('rejects non-positive or missing distances', () => {
    expect(isNearDistance(0, 2000)).toBe(false);
    expect(isNearDistance(2000, 0)).toBe(false);
    expect(isNearDistance(undefined, 2000)).toBe(false);
  });
});
