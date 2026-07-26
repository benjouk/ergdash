import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';
import { reconcilePushSubscription } from '../utils/push.js';

const NotificationsContext = createContext(null);

// Matches the sync poll in SyncContext: notifications are produced by the same
// background sync, so there is nothing to gain from checking more often.
const POLL_INTERVAL_MS = 30000;

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState(null);
  // Whether this profile has the in-app centre switched on. Assumed true until
  // the first response, so the bell does not flicker in on load.
  const [inappEnabled, setInappEnabled] = useState(true);
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ));
  const { activeProfile } = useAuth();
  const toast = useToast();
  // Ids already seen by this tab. The first poll after mount seeds it without
  // toasting, or every reload would replay the whole unread list.
  const seenIdsRef = useRef(null);
  // Guards the once-per-profile push reconciliation below.
  const reconciledRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!activeProfile || !isOnline) return;
    try {
      const data = await api.getNotifications();
      const list = data.notifications || [];
      setNotifications(list);
      setUnreadCount(data.unread_count || 0);
      setInappEnabled(data.inapp_enabled !== false);
      setError(null);

      // Once per profile: line this browser's push subscription up with what
      // the profile's settings say. This provider is keyed on the active
      // profile, so a switch re-runs it - which is the point, since switching
      // does not mint a new browser subscription and Settings may never be
      // opened.
      if (!reconciledRef.current && typeof data.push_enabled === 'boolean') {
        reconciledRef.current = true;
        reconcilePushSubscription(data.push_enabled).catch(() => {});
      }

      if (seenIdsRef.current === null) {
        seenIdsRef.current = new Set(list.map(item => item.id));
        return;
      }
      // Anything unread that this tab has not shown yet arrived while the user
      // was looking at the app - surface it the way a sync result is surfaced.
      for (const item of [...list].reverse()) {
        if (seenIdsRef.current.has(item.id)) continue;
        seenIdsRef.current.add(item.id);
        if (!item.read) toast.info(item.title);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Could not load notifications'));
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

  // Switching profiles remounts this provider (main.jsx keys on profile id),
  // but reset explicitly so a stale list never flashes.
  useEffect(() => {
    seenIdsRef.current = null;
    reconciledRef.current = false;
    setNotifications([]);
    setUnreadCount(0);
  }, [activeProfile?.id]);

  useEffect(() => {
    if (!activeProfile || !isOnline) return undefined;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeProfile, isOnline, refresh]);

  const markAllRead = useCallback(async () => {
    // Optimistic: the badge should clear the instant it is clicked.
    setNotifications(current => current.map(item => ({ ...item, read: true })));
    setUnreadCount(0);
    try {
      await api.markNotificationsRead();
    } catch {
      refresh();
    }
  }, [refresh]);

  const markRead = useCallback(async (id) => {
    setNotifications(current => current.map(
      item => (item.id === id ? { ...item, read: true } : item)
    ));
    setUnreadCount(current => Math.max(0, current - 1));
    try {
      await api.markNotificationRead(id);
    } catch {
      refresh();
    }
  }, [refresh]);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    setUnreadCount(0);
    try {
      await api.clearNotifications();
    } catch {
      refresh();
    }
  }, [refresh]);

  return (
    <NotificationsContext.Provider value={{
      notifications,
      unreadCount,
      inappEnabled,
      error,
      refresh,
      markRead,
      markAllRead,
      clearAll,
    }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationsProvider');
  }
  return context;
}
