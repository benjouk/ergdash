import { describe, expect, it } from 'vitest';
import { buildSyncStatusView, formatSyncAge } from './syncStatus.js';

const NOW = Date.parse('2026-07-21T12:00:00Z');

describe('sync status presentation', () => {
  it('formats useful relative ages', () => {
    expect(formatSyncAge('2026-07-21T11:59:40Z', NOW)).toBe('just now');
    expect(formatSyncAge('2026-07-21T11:30:00Z', NOW)).toBe('30m ago');
    expect(formatSyncAge('2026-07-21T08:00:00Z', NOW)).toBe('4h ago');
    expect(formatSyncAge('2026-07-18T12:00:00Z', NOW)).toBe('3d ago');
  });

  it('makes initial offline state persistent and explicit', () => {
    const view = buildSyncStatusView({
      syncStatus: { status: 'idle', last_completed: '2026-07-21T11:30:00Z' },
      isOnline: false,
      syncError: null,
      now: NOW,
    });

    expect(view).toMatchObject({ tone: 'offline', label: 'Offline', canRetry: false });
    expect(view.detail).toContain('Showing cached data');
    expect(view.detail).toContain('30m ago');
  });

  it('distinguishes errors, stale data, and current data', () => {
    expect(buildSyncStatusView({
      syncStatus: { status: 'error', last_completed: '2026-07-21T11:30:00Z' },
      isOnline: true,
      now: NOW,
    })).toMatchObject({ tone: 'error', label: 'Sync error', canRetry: true });

    expect(buildSyncStatusView({
      syncStatus: { status: 'idle', last_completed: '2026-07-19T12:00:00Z' },
      isOnline: true,
      now: NOW,
    })).toMatchObject({ tone: 'stale', label: 'Synced 2d ago' });

    expect(buildSyncStatusView({
      syncStatus: { status: 'idle', last_completed: '2026-07-21T11:30:00Z' },
      isOnline: true,
      now: NOW,
    })).toMatchObject({ tone: 'current', label: 'Synced 30m ago' });
  });
});
