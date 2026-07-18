import { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { Calculator, Sun, Moon, CalendarRange, ChevronDown, UserPlus } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSync } from '../../context/SyncContext.jsx';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { api } from '../../api.js';
import PaceTrace from './PaceTrace.jsx';
import styles from './Ticker.module.css';

function initialsOf(name) {
  return String(name || '?')
    .split(/\s+/)
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const isDemo = import.meta.env.VITE_DEMO === '1';

export default function Ticker() {
  const { toggleTheme, theme } = useTheme();
  const { profiles, activeProfile, switchProfile } = useAuth();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
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

  useEffect(() => {
    if (!profileMenuOpen) return;

    const handlePointerDown = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileMenuOpen]);

  const isSyncing = syncStatus?.status === 'syncing';

  return (
    <header className={styles.ticker}>
      <div className={styles.logo}>
        Erg<span className={styles.logoAccent}>Dash</span>
      </div>

      <div className={styles.stats}>
        <div className={`${styles.stat} ${styles.statPrimary}`}>
          <span className={styles.statLabel}>{summary?.season_meters > 0 ? 'Season' : 'Total'}</span>
          <span className={styles.statValue}>
            {summary ? formatDistanceFull(summary.season_meters > 0 ? summary.season_meters : summary.total_meters) : '—'}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Steady Pace</span>
          <span className={styles.statValue}>
            {summary ? formatPace(summary.steady_pace) : '—'}
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
        <NavLink to="/plan" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}>
          Plan
        </NavLink>
        <NavLink to="/tools" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}>
          <Calculator size={13} aria-hidden="true" />
          Tools
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}>
          Settings
        </NavLink>
      </nav>

      <div className={`${styles.syncDot} ${isSyncing ? styles.syncDotSyncing : ''}`} title={isSyncing ? 'Syncing...' : 'Up to date'} />

      {activeProfile && (
        <div className={styles.profileWrapper} ref={profileMenuRef}>
          <button
            type="button"
            className={styles.profileButton}
            onClick={() => setProfileMenuOpen(open => !open)}
            aria-haspopup="listbox"
            aria-expanded={profileMenuOpen}
            title={`Profile: ${activeProfile.name}`}
          >
            <span className={styles.profileInitials}>{initialsOf(activeProfile.name)}</span>
            <span className={styles.profileName}>{activeProfile.name}</span>
            <ChevronDown size={12} className={styles.rangeChevron} />
          </button>
          {profileMenuOpen && (
            <ul className={styles.profileMenu} role="listbox">
              {profiles.map(profile => (
                <li key={profile.id} role="option" aria-selected={profile.id === activeProfile.id}>
                  <button
                    type="button"
                    className={`${styles.profileOption} ${profile.id === activeProfile.id ? styles.profileOptionActive : ''}`}
                    onClick={() => {
                      setProfileMenuOpen(false);
                      if (profile.id !== activeProfile.id) switchProfile(profile.id);
                    }}
                  >
                    <span className={styles.profileInitials}>{initialsOf(profile.name)}</span>
                    <span>
                      {profile.name}
                      {!profile.connected && <span className={styles.profileBadge}> · not connected</span>}
                    </span>
                  </button>
                </li>
              ))}
              {!isDemo && (
                <li>
                  <a href="/auth/login?profile=new" className={styles.profileOption}>
                    <UserPlus size={13} aria-hidden="true" />
                    <span>Add profile…</span>
                  </a>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <button className={styles.themeToggle} onClick={toggleTheme} title="Toggle theme">
        {theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
          ? <Sun size={16} />
          : <Moon size={16} />}
      </button>
    </header>
  );
}
