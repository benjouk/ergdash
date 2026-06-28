import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

const SyncContext = createContext();

export function SyncProvider({ children }) {
  const [syncStatus, setSyncStatus] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const status = await api.getSyncStatus();
      setSyncStatus(status);
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const triggerSync = useCallback(async () => {
    await api.triggerSync();
    setTimeout(refresh, 2000);
  }, [refresh]);

  return (
    <SyncContext.Provider value={{ syncStatus, triggerSync, refresh }}>
      {children}
    </SyncContext.Provider>
  );
}

export const useSync = () => useContext(SyncContext);
