import { describe, expect, it } from 'vitest';
import { dayLabel, groupByRecency } from './dateGroups.js';

const now = new Date(2026, 6, 18); // Sat 18 Jul 2026

describe('dayLabel', () => {
  it('labels today and yesterday', () => {
    expect(dayLabel('2026-07-18', 'day-month', now)).toBe('Today');
    expect(dayLabel('2026-07-17', 'day-month', now)).toBe('Yesterday');
  });

  it('labels older days with weekday and date in the preferred order', () => {
    // ICU versions differ on the comma after the weekday
    expect(dayLabel('2026-07-15', 'day-month', now)).toMatch(/^Wed,? 15 Jul$/);
    expect(dayLabel('2026-07-15', 'month-day', now)).toMatch(/^Wed,? Jul 15$/);
  });

  it('includes the year for dates outside the current year', () => {
    expect(dayLabel('2025-12-30', 'day-month', now)).toMatch(/^Tue,? 30 Dec 2025$/);
  });
});

describe('groupByRecency', () => {
  it('groups recent dates by day and combines dates older than a week', () => {
    const workouts = [
      { id: 1, date: '2026-07-18 07:30:00' },
      { id: 2, date: '2026-07-16 18:05:00' },
      { id: 3, date: '2026-07-16 06:24:00' },
      { id: 4, date: '2026-07-11 12:00:00' },
      { id: 5, date: '2026-07-10 12:00:00' },
      { id: 6, date: '2025-12-30 12:00:00' },
    ];
    const groups = groupByRecency(workouts, 'day-month', now);
    expect(groups.map(g => g.key)).toEqual(['2026-07-18', '2026-07-16', '2026-07-11', 'older']);
    expect(groups[0].label).toBe('Today');
    expect(groups[1].items.map(w => w.id)).toEqual([2, 3]);
    expect(groups[2].label).toMatch(/^Sat,? 11 Jul$/);
    expect(groups[3].label).toBe('Older');
    expect(groups[3].items.map(w => w.id)).toEqual([5, 6]);
  });

  it('returns no groups for an empty list', () => {
    expect(groupByRecency([], 'day-month', now)).toEqual([]);
  });
});
