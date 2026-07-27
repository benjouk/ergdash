import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, CheckCircle2, Flame, Trophy, Waves } from 'lucide-react';
import { useNotifications } from '../../context/NotificationsContext.jsx';
import styles from './NotificationBell.module.css';

const KIND_ICONS = {
  plan_reminder: CalendarClock,
  workout_synced: Waves,
  new_pb: Trophy,
  missed_session: CheckCircle2,
  streak_risk: Flame,
};

// Relative time, coarse on purpose: the exact minute a sync landed is noise.
export function timeAgo(isoish) {
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC, which Safari
  // will not parse without the separator and zone made explicit.
  const stamp = /Z|[+-]\d{2}:?\d{2}$/.test(isoish) ? isoish : `${isoish.replace(' ', 'T')}Z`;
  const then = new Date(stamp).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export default function NotificationBell() {
  const { notifications, unreadCount, inappEnabled, markRead, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const openNotification = (notification) => {
    setOpen(false);
    if (!notification.read) markRead(notification.id);
    if (notification.link) navigate(notification.link);
  };

  // Switching the in-app channel off should remove it from the header, not
  // leave a bell that can never fill up.
  if (!inappEnabled) return null;

  const label = unreadCount > 0
    ? `Notifications (${unreadCount} unread)`
    : 'Notifications';

  return (
    <div className={styles.wrapper} ref={menuRef}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.button}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls="notification-panel"
        title={label}
      >
        <Bell size={16} aria-hidden="true" />
        <span className="sr-only">{label}</span>
        {unreadCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div id="notification-panel" className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Notifications</span>
            {notifications.length > 0 && (
              <span className={styles.panelActions}>
                {unreadCount > 0 && (
                  <button type="button" className={styles.panelAction} onClick={markAllRead}>
                    Mark all read
                  </button>
                )}
                <button type="button" className={styles.panelAction} onClick={clearAll}>
                  Clear
                </button>
              </span>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className={styles.empty}>
              Nothing yet. Reminders and new workouts will show up here.
            </p>
          ) : (
            <ul className={styles.list}>
              {notifications.map(notification => {
                const Icon = KIND_ICONS[notification.kind] || Bell;
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      className={`${styles.item} ${notification.read ? '' : styles.itemUnread}`}
                      onClick={() => openNotification(notification)}
                    >
                      <Icon size={15} aria-hidden="true" className={styles.itemIcon} />
                      <span className={styles.itemText}>
                        <span className={styles.itemTitle}>{notification.title}</span>
                        {notification.body && (
                          <span className={styles.itemBody}>{notification.body}</span>
                        )}
                        <span className={styles.itemTime}>{timeAgo(notification.created_at)}</span>
                      </span>
                      {!notification.read && <span className={styles.itemDot} aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
