import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearQueryCache,
  createQueryCacheKey,
  fetchQuery,
  getQuerySnapshot,
  invalidateProfileQueries,
  subscribeToQuery,
} from './queryClient.js';

function queryOptions(profileId, key, queryFn, options = {}) {
  return {
    cacheKey: createQueryCacheKey(profileId, key),
    profileId,
    queryFn,
    tags: [key[0]],
    ...options,
  };
}

afterEach(() => {
  clearQueryCache();
});

describe('profile query client', () => {
  it('deduplicates concurrent reads and reuses fresh data', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const queryFn = vi.fn(() => pending);
    const options = queryOptions('1', ['summary', { from: '2026-01-01' }], queryFn);

    const first = fetchQuery(options);
    const second = fetchQuery(options);
    expect(queryFn).toHaveBeenCalledTimes(1);

    release({ total_meters: 1234 });
    await expect(first).resolves.toEqual({ total_meters: 1234 });
    await expect(second).resolves.toEqual({ total_meters: 1234 });
    await expect(fetchQuery(options)).resolves.toEqual({ total_meters: 1234 });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('keeps identical query keys isolated by profile', async () => {
    const alex = vi.fn().mockResolvedValue({ athlete: 'Alex' });
    const sam = vi.fn().mockResolvedValue({ athlete: 'Sam' });

    await fetchQuery(queryOptions('1', ['settings'], alex));
    await fetchQuery(queryOptions('2', ['settings'], sam));

    expect(getQuerySnapshot(createQueryCacheKey('1', ['settings'])).data).toEqual({ athlete: 'Alex' });
    expect(getQuerySnapshot(createQueryCacheKey('2', ['settings'])).data).toEqual({ athlete: 'Sam' });
  });

  it('retries transient failures but not client errors', async () => {
    const transient = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { status: 503 }))
      .mockResolvedValue({ ok: true });
    await expect(fetchQuery(queryOptions('1', ['summary'], transient))).resolves.toEqual({ ok: true });
    expect(transient).toHaveBeenCalledTimes(2);

    const notFound = vi.fn().mockRejectedValue(Object.assign(new Error('Missing'), { status: 404 }));
    await expect(fetchQuery(queryOptions('1', ['workout', 99], notFound))).rejects.toThrow('Missing');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('refetches subscribed matching tags after invalidation', async () => {
    const key = ['summary', { from: '2026-01-01' }];
    const cacheKey = createQueryCacheKey('1', key);
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ total_meters: 100 })
      .mockResolvedValueOnce({ total_meters: 200 });
    const unsubscribe = subscribeToQuery(cacheKey, '1', () => {});

    await fetchQuery(queryOptions('1', key, queryFn));
    invalidateProfileQueries('1', ['settings']);
    await Promise.resolve();
    expect(queryFn).toHaveBeenCalledTimes(1);

    invalidateProfileQueries('1', ['summary']);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(getQuerySnapshot(cacheKey).data).toEqual({ total_meters: 200 });
    });
    unsubscribe();
  });
});
