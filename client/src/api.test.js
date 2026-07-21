import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addProfileCacheKey,
  clearLegacyOfflineApiEntries,
  clearOfflineApiCache,
} from './api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('profile-aware API cache keys', () => {
  it('adds the active profile to API GET URLs while preserving query params', () => {
    const result = addProfileCacheKey('/api/stats/summary?from=2026-01-01&to=2026-02-01', 7);
    const url = new URL(result, 'http://ergdash.local');

    expect(url.pathname).toBe('/api/stats/summary');
    expect(url.searchParams.get('from')).toBe('2026-01-01');
    expect(url.searchParams.get('to')).toBe('2026-02-01');
    expect(url.searchParams.get('_ergdash_profile')).toBe('7');
  });

  it('does not alter shared auth routes or requests without a selected profile', () => {
    expect(addProfileCacheKey('/auth/status', 7)).toBe('/auth/status');
    expect(addProfileCacheKey('/api/settings', '')).toBe('/api/settings');
  });

  it('clears the complete API runtime cache on logout', async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', { delete: deleteCache });

    await expect(clearOfflineApiCache()).resolves.toBe(true);
    expect(deleteCache).toHaveBeenCalledWith('ergdash-api');
  });

  it('removes only legacy unpartitioned API entries on a profile switch', async () => {
    const requests = [
      { url: 'https://ergdash.test/api/settings' },
      { url: 'https://ergdash.test/api/settings?_ergdash_profile=1' },
      { url: 'https://ergdash.test/auth/status' },
    ];
    const deleteEntry = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({
        keys: vi.fn().mockResolvedValue(requests),
        delete: deleteEntry,
      }),
    });

    await expect(clearLegacyOfflineApiEntries()).resolves.toBe(1);
    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(deleteEntry).toHaveBeenCalledWith(requests[0]);
  });
});
