import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { useUnits } from '../context/UnitsContext.jsx';
import { useSync } from '../context/SyncContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import styles from './Settings.module.css';

const DEFAULT_ZONE_PERCENTS = [60, 70, 80, 90, 100];

function HrZonesSection() {
  const [maxHr, setMaxHr] = useState('');
  const [percents, setPercents] = useState(DEFAULT_ZONE_PERCENTS);
  const [estimatedMax, setEstimatedMax] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(settings => {
      if (settings.max_hr) setMaxHr(settings.max_hr);
      if (settings.hr_zones) {
        try {
          const parsed = JSON.parse(settings.hr_zones);
          if (Array.isArray(parsed) && parsed.length === 5) setPercents(parsed);
        } catch { /* keep defaults */ }
      }
    }).catch(() => {});
    api.getSummary().then(s => setEstimatedMax(s.estimated_max_hr)).catch(() => {});
  }, []);

  const effectiveMax = Number(maxHr) > 0 ? Number(maxHr) : estimatedMax;

  const save = (nextMaxHr, nextPercents) => {
    const payload = { hr_zones: JSON.stringify(nextPercents) };
    if (Number(nextMaxHr) > 0) payload.max_hr = String(nextMaxHr);
    api.updateSettings(payload)
      .then(() => {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1600);
      })
      .catch(() => {});
  };

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Heart Rate Zones</h3>
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Max Heart Rate</div>
          <div className={styles.subtext}>
            {Number(maxHr) > 0
              ? 'Used to compute your five training zones'
              : estimatedMax
                ? `Estimated from your data: ${estimatedMax} bpm`
                : 'No HR data yet — enter it manually'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            type="number"
            min="100"
            max="220"
            value={maxHr}
            placeholder={estimatedMax ? String(estimatedMax) : 'bpm'}
            onChange={e => setMaxHr(e.target.value)}
            onBlur={() => { if (Number(maxHr) > 0) save(maxHr, percents); }}
            aria-label="Max heart rate in bpm"
            className={styles.numberInput}
          />
          {estimatedMax && Number(maxHr) !== estimatedMax && (
            <button
              type="button"
              className={styles.button}
              onClick={() => { setMaxHr(String(estimatedMax)); save(estimatedMax, percents); }}
            >
              Use estimate
            </button>
          )}
        </div>
      </div>
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Zone Thresholds</div>
          <div className={styles.subtext}>
            Upper bound of each zone as % of max{saved ? ' · saved' : ''}
          </div>
        </div>
        <div className={styles.zoneRow}>
          {percents.map((p, i) => (
            <div key={i} className={styles.zoneCell}>
              <div className={styles.zoneName} style={{ color: `var(--zone-${i + 1})` }}>
                Z{i + 1}
              </div>
              {i === 4 ? (
                // Z5 always tops out at 100% of max — show it, don't edit it.
                <div className={styles.zoneFixed} aria-label="Zone 5 upper bound is 100 percent">
                  {p}
                </div>
              ) : (
                <input
                  type="number"
                  min="30"
                  max="99"
                  value={p}
                  aria-label={`Zone ${i + 1} upper bound percent`}
                  onChange={e => {
                    const next = [...percents];
                    next[i] = Number(e.target.value);
                    setPercents(next);
                  }}
                  onBlur={() => {
                    const valid = percents.every((v, idx) =>
                      v > 0 && v <= 100 && (idx === 0 || v > percents[idx - 1]));
                    if (valid) save(maxHr, percents);
                  }}
                  className={styles.numberInput}
                />
              )}
              <div className={styles.zoneBpm}>
                {effectiveMax ? `≤${Math.round((p / 100) * effectiveMax)}` : '—'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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

      <HrZonesSection />

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
