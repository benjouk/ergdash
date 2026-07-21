import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { useToast } from './ToastContext.jsx';
import { useAuth } from './AuthContext.jsx';
import { invalidateProfileQueries } from '../queryClient.js';

const SyncContext = createContext();
const SYNCED_DATA_TAGS = ['summary', 'trends', 'goals', 'pb-history', 'workouts', 'stats', 'plans', 'programs'];

export function SyncProvider({ children }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const toast = useToast();
  const { activeProfile } = useAuth();
  const previousStatusRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const status = await api.getSyncStatus();
      const previousStatus = previousStatusRef.current;
      setSyncStatus(status);
      previousStatusRef.current = status.status;

      if (previousStatus === 'syncing' && status.status === 'idle') {
        toast.success('Sync complete');
        invalidateProfileQueries(activeProfile.id, SYNCED_DATA_TAGS);
      } else if (previousStatus && previousStatus !== 'error' && status.status === 'error') {
        toast.error('Sync failed');
      }
    } catch {}
  }, [activeProfile, toast]);

  useEffect(() => {
    if (!activeProfile) return undefined;
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [activeProfile, refresh]);

  const triggerSync = useCallback(async () => {
    try {
      await api.triggerSync();
      toast.info('Sync started');
      setSyncStatus(current => ({ ...(current || {}), status: 'syncing' }));
      previousStatusRef.current = 'syncing';
      setTimeout(refresh, 2000);
    } catch (err) {
      toast.error(err.message || 'Sync failed');
      throw err;
    }
  }, [refresh, toast]);

  return (
    <SyncContext.Provider value={{ syncStatus, triggerSync, refresh }}>
      {children}
    </SyncContext.Provider>
  );
}

export const useSync = () => useContext(SyncContext);
