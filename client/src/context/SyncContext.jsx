import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { useToast } from './ToastContext.jsx';

const SyncContext = createContext();

export function SyncProvider({ children }) {
  const [syncStatus, setSyncStatus] = useState(null);
  const toast = useToast();
  const previousStatusRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const status = await api.getSyncStatus();
      const previousStatus = previousStatusRef.current;
      setSyncStatus(status);
      previousStatusRef.current = status.status;

      if (previousStatus === 'syncing' && status.status === 'idle') {
        toast.success('Sync complete');
      } else if (previousStatus && previousStatus !== 'error' && status.status === 'error') {
        toast.error('Sync failed');
      }
    } catch {}
  }, [toast]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

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
