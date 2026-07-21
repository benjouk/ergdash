const DEFAULT_STALE_TIME = 15_000;
const EMPTY_SNAPSHOT = Object.freeze({
  data: undefined,
  error: null,
  status: 'idle',
  isFetching: false,
});

const entries = new Map();

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
  }
  return value;
}

export function serializeQueryKey(key) {
  return JSON.stringify(stableValue(Array.isArray(key) ? key : [key]));
}

export function createQueryCacheKey(profileId, key) {
  return `${String(profileId || 'default')}::${serializeQueryKey(key)}`;
}

function getOrCreateEntry(cacheKey, profileId) {
  if (!entries.has(cacheKey)) {
    entries.set(cacheKey, {
      profileId: String(profileId || ''),
      snapshot: EMPTY_SNAPSHOT,
      updatedAt: 0,
      promise: null,
      listeners: new Set(),
      tags: new Set(),
      queryFn: null,
      staleTime: DEFAULT_STALE_TIME,
      retries: 1,
      version: 0,
    });
  }
  return entries.get(cacheKey);
}

function publish(entry, snapshot) {
  entry.snapshot = snapshot;
  entry.listeners.forEach(listener => listener());
}

function shouldRetry(error) {
  return error?.status == null || error.status >= 500;
}

async function runQuery(queryFn, retries) {
  let attempt = 0;
  while (true) {
    try {
      return await queryFn();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      attempt += 1;
    }
  }
}

export function getQuerySnapshot(cacheKey) {
  return entries.get(cacheKey)?.snapshot || EMPTY_SNAPSHOT;
}

export function subscribeToQuery(cacheKey, profileId, listener) {
  const entry = getOrCreateEntry(cacheKey, profileId);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

export function fetchQuery({
  cacheKey,
  profileId,
  queryFn,
  tags = [],
  staleTime = DEFAULT_STALE_TIME,
  retries = 1,
  force = false,
}) {
  const entry = getOrCreateEntry(cacheKey, profileId);
  entry.queryFn = queryFn;
  entry.tags = new Set(tags);
  entry.staleTime = staleTime;
  entry.retries = retries;

  if (entry.promise) return entry.promise;

  const isFresh = entry.snapshot.status === 'success'
    && Date.now() - entry.updatedAt < staleTime;
  if (!force && isFresh) return Promise.resolve(entry.snapshot.data);

  const versionAtStart = entry.version;
  publish(entry, {
    ...entry.snapshot,
    error: null,
    status: entry.snapshot.status === 'success' ? 'success' : 'loading',
    isFetching: true,
  });

  entry.promise = runQuery(queryFn, retries)
    .then(data => {
      if (entry.version === versionAtStart) {
        entry.updatedAt = Date.now();
        publish(entry, { data, error: null, status: 'success', isFetching: false });
      }
      return data;
    })
    .catch(error => {
      if (entry.version === versionAtStart) {
        publish(entry, { data: undefined, error, status: 'error', isFetching: false });
      }
      throw error;
    })
    .finally(() => {
      entry.promise = null;
      if (entry.version !== versionAtStart && entry.listeners.size > 0 && entry.queryFn) {
        fetchQuery({
          cacheKey,
          profileId: entry.profileId,
          queryFn: entry.queryFn,
          tags: [...entry.tags],
          staleTime: entry.staleTime,
          retries: entry.retries,
          force: true,
        }).catch(() => {});
      }
    });

  return entry.promise;
}

export function invalidateProfileQueries(profileId, tags = null) {
  const normalizedProfileId = String(profileId || '');
  const requestedTags = tags ? new Set(tags) : null;

  for (const [cacheKey, entry] of entries) {
    if (entry.profileId !== normalizedProfileId) continue;
    if (requestedTags && ![...entry.tags].some(tag => requestedTags.has(tag))) continue;

    entry.updatedAt = 0;
    entry.version += 1;
    if (entry.listeners.size > 0 && entry.queryFn) {
      fetchQuery({
        cacheKey,
        profileId: entry.profileId,
        queryFn: entry.queryFn,
        tags: [...entry.tags],
        staleTime: entry.staleTime,
        retries: entry.retries,
        force: true,
      }).catch(() => {});
    }
  }
}

export function clearQueryCache(profileId) {
  const normalizedProfileId = profileId == null ? null : String(profileId || '');
  for (const [cacheKey, entry] of entries) {
    if (normalizedProfileId != null && entry.profileId !== normalizedProfileId) continue;
    entries.delete(cacheKey);
    entry.listeners.forEach(listener => listener());
  }
}

export { DEFAULT_STALE_TIME };
