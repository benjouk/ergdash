import { describe, expect, it } from 'vitest';
import { precedingDateRange } from '../src/routes/stats.js';

describe('precedingDateRange', () => {
  it('returns the immediately preceding equal-length bounded range', () => {
    expect(precedingDateRange('2026-05-01', '2026-07-01')).toEqual({
      from: '2026-03-01',
      to: '2026-05-01',
      days: 61,
    });
  });

  it('uses tomorrow as the exclusive end for an open current range', () => {
    const now = Date.parse('2026-07-18T12:00:00Z');
    expect(precedingDateRange('2026-06-19', null, now)).toEqual({
      from: '2026-05-20',
      to: '2026-06-19',
      days: 30,
    });
  });

  it('returns null for All Time and invalid windows', () => {
    expect(precedingDateRange(null, null)).toBeNull();
    expect(precedingDateRange('2026-07-01', '2026-06-01')).toBeNull();
  });
});
