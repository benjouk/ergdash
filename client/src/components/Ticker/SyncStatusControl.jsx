import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, RefreshCw, WifiOff } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useSync } from '../../context/SyncContext.jsx';
import { buildSyncStatusView } from './syncStatus.js';
import styles from './Ticker.module.css';

const STATUS_ICONS = {
  current: Check,
  stale: AlertCircle,
  error: AlertCircle,
  offline: WifiOff,
  syncing: RefreshCw,
};

export default function SyncStatusControl() {
  const { syncStatus, isOnline, syncError, isChecking, refresh } = useSync();
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const wrapperRef = useRef(null);
  const view = useMemo(
    () => buildSyncStatusView({ syncStatus, isOnline, syncError, now: clock }),
    [clock, isOnline, syncError, syncStatus]
  );
  const Icon = STATUS_ICONS[view.tone] || Check;

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = event => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.syncStatusWrapper} ref={wrapperRef}>
      <button
        type="button"
        className={`${styles.syncStatusButton} ${styles[`syncStatus_${view.tone}`]}`}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls="sync-status-details"
        aria-label={`${view.heading}. ${view.detail}`}
      >
        <Icon size={13} aria-hidden="true" className={view.tone === 'syncing' ? styles.syncStatusSpin : ''} />
        <span className={styles.syncStatusText} aria-live="polite">{view.label}</span>
      </button>
      {open && (
        <div id="sync-status-details" className={styles.syncStatusPopover} role="status">
          <strong>{view.heading}</strong>
          <p>{view.detail}</p>
          <div className={styles.syncStatusActions}>
            {view.needsReconnect ? (
              <NavLink to="/settings" onClick={() => setOpen(false)}>Open Settings</NavLink>
            ) : view.canRetry ? (
              <button type="button" onClick={refresh} disabled={isChecking || !isOnline}>
                <RefreshCw size={12} aria-hidden="true" />
                {isChecking ? 'Checking…' : 'Retry'}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
