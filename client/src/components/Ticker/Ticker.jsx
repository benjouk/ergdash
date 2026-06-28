import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Sun, Moon, Activity } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useSync } from '../../context/SyncContext.jsx';
import { useUnits } from '../../context/UnitsContext.jsx';
import { api } from '../../api.js';
import PaceTrace from './PaceTrace.jsx';
import styles from './Ticker.module.css';

export default function Ticker() {
  const { toggleTheme, theme } = useTheme();
  const { syncStatus } = useSync();
  const { formatPace, formatDistanceFull } = useUnits();
  const [summary, setSummary] = useState(null);
  const [paceTrend, setPaceTrend] = useState(null);

  useEffect(() => {
    api.getSummary().then(setSummary).catch(() => {});
    api.getTrends({ metric: 'pace', period: '90d' }).then(data => {
      const rows = data.pace_trend || [];
      if (rows.length > 0) return setPaceTrend(rows.slice(-30));
      return api.getTrends({ metric: 'pace', period: 'all' }).then(d2 => {
        setPaceTrend((d2.pace_trend || []).slice(-30));
      });
    }).catch(() => {});
  }, []);

  const isSyncing = syncStatus?.status === 'syncing';

  return (
    <header className={styles.ticker}>
      <div className={styles.logo}>
        ROW<span className={styles.logoSlash}>//</span>DASH
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
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

      <nav className={styles.nav}>
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
