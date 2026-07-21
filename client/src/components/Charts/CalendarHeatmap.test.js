import { describe, expect, it } from 'vitest';
import { calendarAccessibilitySummary } from './CalendarHeatmap.jsx';

describe('calendar accessibility summary', () => {
  it('summarizes training and plan outcomes without exposing every SVG cell', () => {
    const summary = calendarAccessibilitySummary({
      total: 15_000,
      cells: [
        { meters: 5000, plan: 'completed' },
        { meters: 10_000, plan: null },
        { meters: 0, plan: 'missed' },
        { meters: 0, plan: null },
      ],
    });

    expect(summary).toContain('15,000 metres across 2 training days');
    expect(summary).toContain('1 planned day was completed and 1 was missed');
  });
});
