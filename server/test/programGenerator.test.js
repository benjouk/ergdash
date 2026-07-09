import { describe, it, expect } from 'vitest';
import {
  generateProgramSessions, validateProgramInput, resolveDurationWeeks,
  weekdayOf, weekOfDate,
} from '../src/programGenerator.js';
import { getPreset, anchorSlot } from '../src/programPresets.js';

const pete = getPreset('pete-plan');
const beginner = getPreset('beginner-pete');
const prep = getPreset('2k-prep');

describe('weekday helpers', () => {
  it('maps ISO dates to a Monday-based weekday index', () => {
    expect(weekdayOf('2026-07-06')).toBe(0); // Monday
    expect(weekdayOf('2026-07-09')).toBe(3); // Thursday
    expect(weekdayOf('2026-07-12')).toBe(6); // Sunday
  });

  it('finds the Monday of the containing week', () => {
    expect(weekOfDate('2026-07-09')).toBe('2026-07-06');
    expect(weekOfDate('2026-07-06')).toBe('2026-07-06');
  });
});

describe('resolveDurationWeeks', () => {
  it('clamps cycle durations and defaults when unset', () => {
    expect(resolveDurationWeeks(pete, 6)).toBe(6);
    expect(resolveDurationWeeks(pete, 999)).toBe(pete.maxWeeks);
    expect(resolveDurationWeeks(pete, 1)).toBe(pete.minWeeks);
    expect(resolveDurationWeeks(pete, undefined)).toBe(pete.defaultWeeks);
  });

  it('locks fixed presets to their template length', () => {
    expect(resolveDurationWeeks(beginner, 5)).toBe(24);
  });
});

describe('generateProgramSessions — weekday mapping', () => {
  it('places each slot on its training day, week over week', () => {
    // Mon/Wed/Fri, start on a Monday.
    const { sessions } = generateProgramSessions(beginner, {
      startDate: '2026-07-06', trainingDays: [0, 2, 4], durationWeeks: 24,
    });
    expect(sessions).toHaveLength(24 * 3);
    // Week 0 slots.
    expect(sessions[0].date).toBe('2026-07-06'); // Mon, slot 0
    expect(sessions[1].date).toBe('2026-07-08'); // Wed, slot 1
    expect(sessions[2].date).toBe('2026-07-10'); // Fri, slot 2
    // Week 1 slot 0 is exactly 7 days later.
    const wk1 = sessions.find(s => s.program_week === 1 && s.program_slot === 0);
    expect(wk1.date).toBe('2026-07-13');
    // Program columns carry through.
    expect(sessions[0].type).toBe(beginner.weeks[0].sessions[0].type);
  });

  it('sorts unsorted training days by weekday', () => {
    const { sessions } = generateProgramSessions(beginner, {
      startDate: '2026-07-06', trainingDays: [4, 0, 2], durationWeeks: 24,
    });
    // Slot 0 is the earliest weekday (Mon) regardless of input order.
    expect(sessions[0].date).toBe('2026-07-06');
  });

  it('drops week-0 sessions before a mid-week start', () => {
    // Start Wednesday: Monday's slot-0 session is dropped.
    const { sessions, startDate } = generateProgramSessions(beginner, {
      startDate: '2026-07-08', trainingDays: [0, 2, 4], durationWeeks: 24,
    });
    expect(startDate).toBe('2026-07-08');
    expect(sessions.every(s => s.date >= '2026-07-08')).toBe(true);
    // First week now only has Wed + Fri.
    expect(sessions.filter(s => s.program_week === 0)).toHaveLength(2);
  });
});

describe('generateProgramSessions — cycle wrap', () => {
  it('reuses template week k % cycleWeeks', () => {
    const { sessions } = generateProgramSessions(pete, {
      startDate: '2026-07-06', trainingDays: [0, 1, 2, 3, 4], durationWeeks: 12,
    });
    const wk0slot0 = sessions.find(s => s.program_week === 0 && s.program_slot === 0);
    const wk3slot0 = sessions.find(s => s.program_week === 3 && s.program_slot === 0);
    // Week 3 wraps to template week 0 → same session content.
    expect(wk3slot0.interval_reps).toBe(wk0slot0.interval_reps);
    expect(wk3slot0.interval_distance).toBe(wk0slot0.interval_distance);
    expect(sessions).toHaveLength(12 * 5);
  });
});

describe('generateProgramSessions — race anchor', () => {
  it('lands the anchored session exactly on the race date and back-computes the start', () => {
    const raceDate = '2026-09-05'; // a Saturday
    const { sessions, startDate } = generateProgramSessions(prep, {
      trainingDays: [1, 3, 5, 6], raceDate, // Tue/Thu/Sat/Sun
    });
    const race = sessions.find(s => s.type === 'race');
    expect(race.date).toBe(raceDate);
    expect(race.program_week).toBe(prep.weeks.length - 1);
    // Start is the earliest generated session, ~8 weeks before the race.
    expect(startDate < raceDate).toBe(true);
    const anchor = anchorSlot(prep);
    expect(anchor.week).toBe(prep.weeks.length - 1);
  });

  it('never schedules a session after race day', () => {
    const raceDate = '2026-09-01'; // a Tuesday, early in the week
    const { sessions } = generateProgramSessions(prep, {
      trainingDays: [1, 3, 5, 6], raceDate,
    });
    expect(sessions.every(s => s.date <= raceDate)).toBe(true);
    expect(sessions.some(s => s.type === 'race')).toBe(true);
  });
});

describe('anchor key is stripped from generated rows', () => {
  it('does not leak the anchor property into session rows', () => {
    const { sessions } = generateProgramSessions(prep, {
      trainingDays: [1, 3, 5, 6], raceDate: '2026-09-05',
    });
    expect(sessions.every(s => !('anchor' in s))).toBe(true);
  });
});

describe('validateProgramInput', () => {
  it('accepts a well-formed cycle request', () => {
    expect(validateProgramInput(pete, {
      start_date: '2026-07-06', training_days: [0, 1, 2, 3, 4], duration_weeks: 12,
    })).toEqual([]);
  });

  it('rejects the wrong number of training days', () => {
    const errors = validateProgramInput(pete, { start_date: '2026-07-06', training_days: [0, 1] });
    expect(errors.join(' ')).toMatch(/training_days/);
  });

  it('rejects duplicate or out-of-range weekdays', () => {
    expect(validateProgramInput(pete, {
      start_date: '2026-07-06', training_days: [0, 0, 2, 3, 4],
    }).join(' ')).toMatch(/training_days/);
    expect(validateProgramInput(pete, {
      start_date: '2026-07-06', training_days: [0, 1, 2, 3, 7],
    }).join(' ')).toMatch(/training_days/);
  });

  it('requires the start date to be a training day', () => {
    // 2026-07-07 is a Tuesday (weekday 1), not in Mon/Wed/Fri/Sat/Sun.
    const errors = validateProgramInput(pete, {
      start_date: '2026-07-07', training_days: [0, 2, 4, 5, 6],
    });
    expect(errors.join(' ')).toMatch(/training days/);
  });

  it('requires a race date for race presets', () => {
    const errors = validateProgramInput(prep, { training_days: [1, 3, 5, 6] });
    expect(errors.join(' ')).toMatch(/race_date/);
  });

  it('rejects an out-of-bounds cycle duration', () => {
    const errors = validateProgramInput(pete, {
      start_date: '2026-07-06', training_days: [0, 1, 2, 3, 4], duration_weeks: 2,
    });
    expect(errors.join(' ')).toMatch(/duration_weeks/);
  });
});
