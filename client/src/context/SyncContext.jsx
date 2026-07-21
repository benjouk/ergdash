import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { useToast } from './ToastContext.jsx';
import { useAuth } from './AuthContext.jsx';
import { invalidateProfileQueries } from '../queryClient.js';

const SyncContext = createContext();
const SYNCED_DATA_TAGS = ['summary', 'trends', 'goals', 'pb-history', 'workouts', 'stats', 'plans', 'programs'];

export function SyncProvider({ children }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ));
  const toast = useToast();
  const { activeProfile } = useAuth();
  const previousStatusRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!activeProfile || !isOnline) return;
    setIsChecking(true);
    try {
      const status = await api.getSyncStatus();
      const previousStatus = previousStatusRef.current;
      setSyncStatus(status);
      setSyncError(null);
      previousStatusRef.current = status.status;

      if (previousStatus === 'syncing' && status.status === 'idle') {
        toast.success('Sync complete');
        invalidateProfileQueries(activeProfile.id, SYNCED_DATA_TAGS);
      } else if (previousStatus && previousStatus !== 'error' && status.status === 'error') {
        toast.error('Sync failed');
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error : new Error('Could not check sync status'));
    } finally {
      setIsChecking(false);
    }
  }, [activeProfile, isOnline, toast]);

  useEffect(() => {
    const wentOnline = () => setIsOnline(true);
    const wentOffline = () => setIsOnline(false);
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    return () => {
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
    };
  }, []);

  useEffect(() => {
    if (!activeProfile || !isOnline) return undefined;
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [activeProfile, isOnline, refresh]);

  const triggerSync = useCallback(async () => {
    if (!isOnline) {
      const error = new Error('You are offline. Reconnect before starting a sync.');
      setSyncError(error);
      toast.error(error.message);
      throw error;
    }
    try {
      await api.triggerSync();
      setSyncError(null);
      toast.info('Sync started');
      setSyncStatus(current => ({ ...(current || {}), status: 'syncing' }));
      previousStatusRef.current = 'syncing';
      setTimeout(refresh, 2000);
    } catch (err) {
      setSyncError(err instanceof Error ? err : new Error('Sync failed'));
      toast.error(err.message || 'Sync failed');
      throw err;
    }
  }, [isOnline, refresh, toast]);

  return (
    <SyncContext.Provider value={{
      syncStatus,
      syncError,
      isChecking,
      isOnline,
      triggerSync,
      refresh,
    }}>
      {children}
    </SyncContext.Provider>
  );
}

export const useSync = () => useContext(SyncContext);
