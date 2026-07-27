import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeAgo } from './NotificationBell.jsx';

afterEach(() => {
  vi.useRealTimers();
});

function atNow(iso) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('timeAgo', () => {
  // The server stores created_at as SQLite datetime('now'): a space-separated
  // UTC string with no zone marker. Treating that as local time would show
  // every notification hours out on any non-UTC machine.
  it('reads a SQLite UTC timestamp as UTC', () => {
    atNow('2026-07-26T12:30:00Z');
    expect(timeAgo('2026-07-26 12:00:00')).toBe('30m ago');
  });

  it('still handles an explicit ISO timestamp', () => {
    atNow('2026-07-26T12:30:00Z');
    expect(timeAgo('2026-07-26T12:00:00Z')).toBe('30m ago');
  });

  it('coarsens as events age', () => {
    atNow('2026-07-26T12:00:00Z');
    expect(timeAgo('2026-07-26 11:59:40')).toBe('just now');
    expect(timeAgo('2026-07-26 09:00:00')).toBe('3h ago');
    expect(timeAgo('2026-07-25 12:00:00')).toBe('yesterday');
    expect(timeAgo('2026-07-22 12:00:00')).toBe('4d ago');
  });

  it('returns an empty string rather than NaN for an unparseable value', () => {
    expect(timeAgo('not a date')).toBe('');
  });
});
