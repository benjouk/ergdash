import { describe, expect, it } from 'vitest';
import { addProfileCacheKey } from './api.js';

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
});
