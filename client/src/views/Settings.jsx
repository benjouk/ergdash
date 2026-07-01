import { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { useUnits } from '../context/UnitsContext.jsx';
import { useSync } from '../context/SyncContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import styles from './Settings.module.css';

function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className={styles.segmented} role="group" aria-label={ariaLabel}>
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          aria-pressed={value === val}
          className={`${styles.segment} ${value === val ? styles.segmentActive : ''}`}
        >{label}</button>
      ))}
    </div>
  );
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { units, setUnits } = useUnits();
  const { syncStatus, triggerSync } = useSync();
  const { user, logout } = useAuth();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch('/health').then(r => r.json()).then(setHealth).catch(() => {});
  }, []);

  return (
    <div className={styles.settings}>
      <h2 className={styles.title}>Settings</h2>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Appearance</h3>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Theme</div>
            <div className={styles.subtext}>Controls light and dark mode</div>
          </div>
          <Segmented
            ariaLabel="Theme"
            options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]}
            value={theme}
            onChange={setTheme}
          />
        </div>

        <div className={styles.row}>
          <div>
            <div className={styles.label}>Units</div>
            <div className={styles.subtext}>Display format for pace values</div>
          </div>
          <Segmented
            ariaLabel="Units"
            options={[['pace', '/500m'], ['watts', 'Watts'], ['calhr', 'Cal/hr']]}
            value={units}
            onChange={setUnits}
          />
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Concept2 Connection</h3>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Status</div>
            <div className={styles.subtext}>
              {user ? `Connected as ${user.first_name} ${user.last_name}` : 'Not connected'}
            </div>
          </div>
          {user ? (
            <button onClick={logout} className={`${styles.button} ${styles.buttonDanger}`}>Disconnect</button>
          ) : (
            <a href="/auth/login" className={`${styles.button} ${styles.buttonPrimary}`}>Connect</a>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Sync</h3>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Status</div>
            <div className={styles.subtext}>
              {syncStatus?.status === 'syncing' ? 'Syncing...' : `Last sync: ${syncStatus?.last_completed || 'Never'}`}
            </div>
          </div>
          <button onClick={triggerSync} className={styles.button}>Sync Now</button>
        </div>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Stroke Data</div>
            <div className={styles.subtext}>Enrichment progress</div>
          </div>
          <span className={styles.mono}>
            {syncStatus?.enrichment_progress || '—'}
          </span>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Data</h3>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Database</div>
            <div className={styles.subtext}>
              {health ? `${(health.database.size_bytes / 1024 / 1024).toFixed(1)} MB · ${health.database.workout_count} workouts` : '—'}
            </div>
          </div>
        </div>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Version</div>
            <div className={styles.subtext}>{health?.version || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
