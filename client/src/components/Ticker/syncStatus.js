export const SYNC_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function formatSyncAge(value, now = Date.now()) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  return `${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`;
}

function lastSyncDetail(lastAge) {
  return lastAge ? `Last successful sync ${lastAge}.` : 'No successful sync has been recorded yet.';
}

export function buildSyncStatusView({ syncStatus, isOnline, syncError, now = Date.now() }) {
  const lastCompleted = syncStatus?.last_completed || null;
  const lastAge = formatSyncAge(lastCompleted, now);
  const lastTimestamp = lastCompleted ? new Date(lastCompleted).getTime() : null;

  if (!isOnline) {
    return {
      tone: 'offline',
      label: 'Offline',
      heading: 'Offline',
      detail: `Showing cached data. ${lastSyncDetail(lastAge)}`,
      canRetry: false,
    };
  }

  if (syncStatus?.status === 'syncing') {
    return {
      tone: 'syncing',
      label: 'Syncing',
      heading: 'Sync in progress',
      detail: syncStatus.sync_progress || 'Fetching your latest Concept2 workouts.',
      canRetry: false,
    };
  }

  if (syncStatus?.status === 'auth_error') {
    return {
      tone: 'error',
      label: 'Reconnect',
      heading: 'Concept2 reconnect needed',
      detail: `Authorization has expired. ${lastSyncDetail(lastAge)}`,
      canRetry: false,
      needsReconnect: true,
    };
  }

  if (syncError || syncStatus?.status === 'error') {
    return {
      tone: 'error',
      label: 'Sync error',
      heading: 'Sync failed',
      detail: `${syncError?.message || 'The latest Concept2 sync did not complete.'} ${lastSyncDetail(lastAge)}`,
      canRetry: true,
    };
  }

  if (!lastAge) {
    return {
      tone: 'stale',
      label: 'Not synced',
      heading: 'No successful sync yet',
      detail: 'Run a sync to fetch the latest Concept2 workouts.',
      canRetry: true,
    };
  }

  const stale = Number.isFinite(lastTimestamp) && now - lastTimestamp >= SYNC_STALE_AFTER_MS;
  return {
    tone: stale ? 'stale' : 'current',
    label: `Synced ${lastAge}`,
    heading: stale ? 'Data may be stale' : 'Up to date',
    detail: lastSyncDetail(lastAge),
    canRetry: true,
  };
}
