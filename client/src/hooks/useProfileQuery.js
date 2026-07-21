import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  createQueryCacheKey,
  fetchQuery,
  getQuerySnapshot,
  serializeQueryKey,
  subscribeToQuery,
} from '../queryClient.js';

export function useProfileQuery(key, queryFn, options = {}) {
  const { activeProfile, isLoading: isAuthLoading } = useAuth();
  const profileId = activeProfile?.id == null ? '' : String(activeProfile.id);
  const serializedKey = serializeQueryKey(key);
  const cacheKey = createQueryCacheKey(profileId, key);
  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  const enabled = (options.enabled ?? true) && !isAuthLoading && Boolean(profileId);
  const tags = options.tags || [Array.isArray(key) ? key[0] : key];
  const serializedTags = JSON.stringify(tags);

  const subscribe = useCallback(
    listener => subscribeToQuery(cacheKey, profileId, listener),
    [cacheKey, profileId]
  );
  const getSnapshot = useCallback(() => getQuerySnapshot(cacheKey), [cacheKey]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    fetchQuery({
      cacheKey,
      profileId,
      queryFn: () => queryFnRef.current(),
      tags: JSON.parse(serializedTags),
      staleTime: options.staleTime,
      retries: options.retries,
    }).catch(() => {});
  }, [cacheKey, enabled, options.retries, options.staleTime, profileId, serializedKey, serializedTags]);

  const refetch = useCallback(() => {
    if (!enabled) return Promise.resolve(undefined);
    return fetchQuery({
      cacheKey,
      profileId,
      queryFn: () => queryFnRef.current(),
      tags: JSON.parse(serializedTags),
      staleTime: options.staleTime,
      retries: options.retries,
      force: true,
    });
  }, [cacheKey, enabled, options.retries, options.staleTime, profileId, serializedTags]);

  return {
    ...snapshot,
    loading: enabled && (snapshot.status === 'idle' || snapshot.status === 'loading'),
    refetch,
  };
}
