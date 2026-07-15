import { describe, expect, it } from 'vitest';
import { formatDuration } from './ZoneBar.jsx';

describe('ZoneBar formatDuration', () => {
  it('shows short zones as mm:ss instead of rounding them away', () => {
    expect(formatDuration(20)).toBe('0:20');
    expect(formatDuration(90)).toBe('1:30');
  });

  it('pads seconds and switches to h:mm:ss past an hour', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('clamps negatives to zero', () => {
    expect(formatDuration(-5)).toBe('0:00');
  });
});
