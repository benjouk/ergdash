import { describe, it, expect } from 'vitest';
import { monthGrid, shiftMonth, weekdayLabels } from './planCalendar.js';

describe('monthGrid', () => {
  it('starts the grid on the week-start day before the 1st', () => {
    // July 2026 starts on a Wednesday.
    const grid = monthGrid(2026, 6, 'monday');
    expect(grid.weeks[0][0].date).toBe('2026-06-29');
    expect(grid.weeks[0][0].inMonth).toBe(false);
    expect(grid.weeks[0][2].date).toBe('2026-07-01');
    expect(grid.weeks[0][2].inMonth).toBe(true);
  });

  it('respects a sunday week start', () => {
    const grid = monthGrid(2026, 6, 'sunday');
    expect(grid.weeks[0][0].date).toBe('2026-06-28');
    expect(grid.weeks[0][3].date).toBe('2026-07-01');
  });

  it('covers the whole month in full weeks', () => {
    const grid = monthGrid(2026, 6, 'monday');
    const dates = grid.weeks.flat().map(d => d.date);
    expect(dates).toContain('2026-07-01');
    expect(dates).toContain('2026-07-31');
    expect(dates.length % 7).toBe(0);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
  });

  it('returns a [from, to) fetch range spanning the grid', () => {
    const grid = monthGrid(2026, 6, 'monday');
    expect(grid.from).toBe(grid.weeks[0][0].date);
    const lastCell = grid.weeks.at(-1).at(-1).date;
    expect(grid.to > lastCell).toBe(true);
  });

  it('handles February in a leap year', () => {
    const grid = monthGrid(2024, 1, 'monday');
    const dates = grid.weeks.flat().map(d => d.date);
    expect(dates).toContain('2024-02-29');
    expect(dates).not.toContain('2024-03-04');
  });

  it('starts exactly on the 1st when it falls on the week start', () => {
    // June 2026 starts on a Monday.
    const grid = monthGrid(2026, 5, 'monday');
    expect(grid.weeks[0][0].date).toBe('2026-06-01');
    expect(grid.weeks[0][0].inMonth).toBe(true);
  });
});

describe('shiftMonth', () => {
  it('moves forward and backward across year boundaries', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 6, 0)).toEqual({ year: 2026, month: 6 });
  });
});

describe('weekdayLabels', () => {
  it('orders labels by week start', () => {
    expect(weekdayLabels('monday')[0]).toBe('Mon');
    expect(weekdayLabels('sunday')[0]).toBe('Sun');
    expect(weekdayLabels('sunday')).toHaveLength(7);
  });
});
