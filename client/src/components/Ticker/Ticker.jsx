import { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { Sun, Moon, CalendarRange, ChevronDown } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useSync } from '../../context/SyncContext.jsx';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { api } from '../../api.js';
import PaceTrace from './PaceTrace.jsx';
import styles from './Ticker.module.css';

export default function Ticker() {
  const { toggleTheme, theme } = useTheme();
  const { syncStatus } = useSync();
  const { formatPace, formatDistanceFull } = useUnits();
  const { rangeKey, setRange, from, to, PRESETS, describeRange } = useTimeRange();
  const [summary, setSummary] = useState(null);
  const [paceTrend, setPaceTrend] = useState(null);
  const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
  const rangeMenuRef = useRef(null);

  useEffect(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    api.getSummary(params).then(setSummary).catch(() => {});
    api.getTrends({ metric: 'pace', period: 'all', ...params }).then(data => {
      const rows = data.pace_trend || [];
      setPaceTrend(rows.slice(-30));
    }).catch(() => {});
  }, [from, to]);

  useEffect(() => {
    if (!rangeMenuOpen) return;

    const handlePointerDown = (event) => {
      if (rangeMenuRef.current && !rangeMenuRef.current.contains(event.target)) {
        setRangeMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setRangeMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [rangeMenuOpen]);

  const isSyncing = syncStatus?.status === 'syncing';

  return (
    <header className={styles.ticker}>
      <div className={styles.logo}>
        ROW<span className={styles.logoSlash}>//</span>DASH
      </div>

      <div className={styles.stats}>
        <div className={`${styles.stat} ${styles.statPrimary}`}>
          <span className={styles.statLabel}>{summary?.season_meters > 0 ? 'Season' : 'Total'}</span>
          <span className={styles.statValue}>
            {summary ? formatDistanceFull(summary.season_meters > 0 ? summary.season_meters : summary.total_meters) : '—'}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Avg Pace</span>
          <span className={styles.statValue}>
            {summary ? formatPace(summary.avg_pace) : '—'}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Streak</span>
          <span className={styles.statValue}>
            {summary ? `${summary.current_streak_weeks}w` : '—'}
          </span>
        </div>
      </div>

      <div className={styles.traceContainer}>
        <PaceTrace data={paceTrend} />
      </div>

      <div className={styles.rangeWrapper} ref={rangeMenuRef}>
        <button
          type="button"
          onClick={() => setRangeMenuOpen(open => !open)}
          className={styles.rangeButton}
          aria-haspopup="listbox"
          aria-expanded={rangeMenuOpen}
        >
          <CalendarRange size={13} />
          <span>{PRESETS[rangeKey]}</span>
          <ChevronDown size={12} className={styles.rangeChevron} />
        </button>
        {rangeMenuOpen && (
          <ul className={styles.rangeMenu} role="listbox">
            {Object.entries(PRESETS).map(([k, label]) => (
              <li key={k} role="option" aria-selected={rangeKey === k}>
                <button
                  type="button"
                  className={`${styles.rangeOption} ${rangeKey === k ? styles.rangeOptionActive : ''}`}
                  onClick={() => { setRange(k); setRangeMenuOpen(false); }}
                >
                  <span className={styles.rangeOptionLabel}>{label}</span>
                  <span className={styles.rangeOptionContext}>{describeRange(k)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <nav className={styles.nav} aria-label="Primary">
        <NavLink to="/" end className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}>
          Dashboard
        </NavLink>
        <NavLink to="/progress" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}>
          Progress
        </NavLink>
        <NavLink to="/workouts" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}>
          Workouts
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}>
          Settings
        </NavLink>
      </nav>

      <div className={`${styles.syncDot} ${isSyncing ? styles.syncDotSyncing : ''}`} title={isSyncing ? 'Syncing...' : 'Up to date'} />

      <button className={styles.themeToggle} onClick={toggleTheme} title="Toggle theme">
        {theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
          ? <Sun size={16} />
          : <Moon size={16} />}
      </button>
    </header>
  );
}
