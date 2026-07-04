import { useState, useEffect } from 'react';
import { Download, FileJson, LogOut, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { useUnits } from '../context/UnitsContext.jsx';
import { useSync } from '../context/SyncContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { usePrefs } from '../context/PrefsContext.jsx';
import styles from './Settings.module.css';

const DEFAULT_ZONE_PERCENTS = [60, 70, 80, 90, 100];

function HrZonesSection() {
  const [maxHr, setMaxHr] = useState('');
  const [percents, setPercents] = useState(DEFAULT_ZONE_PERCENTS);
  const [estimatedMax, setEstimatedMax] = useState(null);
  const [saved, setSaved] = useState(false);
  const toast = useToast();

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
        toast.success('Settings saved');
        window.setTimeout(() => setSaved(false), 1600);
      })
      .catch(err => {
        toast.error(err.message || 'Could not save settings');
      });
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

function SelectRow({ label, subtext, value, onChange, options }) {
  return (
    <div className={styles.row}>
      <div>
        <div className={styles.label}>{label}</div>
        <div className={styles.subtext}>{subtext}</div>
      </div>
      <select
        className={styles.select}
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

const isDemo = import.meta.env.VITE_DEMO === '1';

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { units, setUnits } = useUnits();
  const { syncStatus, triggerSync } = useSync();
  const { user } = useAuth();
  const { defaultLanding, feedLimit, weekStart, dateFormat, updatePref } = usePrefs();
  const toast = useToast();
  const [health, setHealth] = useState(null);
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreConfirm, setRestoreConfirm] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [dangerConfirm, setDangerConfirm] = useState('');
  const [wipeConfirm, setWipeConfirm] = useState('');
  const [dangerBusy, setDangerBusy] = useState('');

  useEffect(() => {
    fetch('/health').then(r => r.json()).then(setHealth).catch(() => {});
  }, []);

  const saveTheme = (nextTheme) => {
    setTheme(nextTheme)
      .then(() => toast.success('Settings saved'))
      .catch(err => toast.error(err.message || 'Could not save settings'));
  };

  const saveUnits = (nextUnits) => {
    setUnits(nextUnits)
      .then(() => toast.success('Settings saved'))
      .catch(err => toast.error(err.message || 'Could not save settings'));
  };

  const savePref = (key, value) => {
    updatePref(key, value)
      .then(() => toast.success('Settings saved'))
      .catch(err => toast.error(err.message || 'Could not save settings'));
  };

  const restoreDatabase = async (event) => {
    event.preventDefault();
    if (!restoreFile || restoreConfirm !== 'RESTORE') return;
    setRestoreBusy(true);
    try {
      await api.restoreDatabase(restoreFile);
      toast.success('Database restored');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      toast.error(err.message || 'Restore failed');
      setRestoreBusy(false);
    }
  };

  const resetSettings = async () => {
    if (resetConfirm !== 'RESET') return;
    try {
      await api.resetSettings();
      toast.success('Settings reset');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      toast.error(err.message || 'Could not reset settings');
    }
  };

  const disconnectAccount = async () => {
    if (dangerConfirm !== 'DISCONNECT') return;
    setDangerBusy('disconnect');
    try {
      await api.disconnectAccount();
      toast.success('Concept2 account disconnected');
      window.location.href = '/';
    } catch (err) {
      toast.error(err.message || 'Disconnect failed');
      setDangerBusy('');
    }
  };

  const wipeLocalData = async () => {
    if (wipeConfirm !== 'WIPE') return;
    setDangerBusy('wipe');
    try {
      await api.wipeLocalData();
      toast.success('Local data wiped. Re-sync started');
      window.setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      toast.error(err.message || 'Wipe failed');
      setDangerBusy('');
    }
  };

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
            onChange={saveTheme}
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
            onChange={saveUnits}
          />
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Preferences</h3>
        <SelectRow
          label="Default Landing"
          subtext="Choose the first view after connecting"
          value={defaultLanding}
          onChange={value => savePref('default_landing', value)}
          options={[
            { value: '/', label: 'Dashboard' },
            { value: '/progress', label: 'Progress' },
            { value: '/workouts', label: 'Workouts' },
          ]}
        />
        <SelectRow
          label="Feed Limit"
          subtext="Recent sessions shown in the side feed"
          value={String(feedLimit)}
          onChange={value => savePref('feed_limit', value)}
          options={[
            { value: '25', label: '25 sessions' },
            { value: '50', label: '50 sessions' },
            { value: '100', label: '100 sessions' },
            { value: '200', label: '200 sessions' },
          ]}
        />
        <SelectRow
          label="Week Start"
          subtext="Used by client-rendered weekly views"
          value={weekStart}
          onChange={value => savePref('week_start', value)}
          options={[
            { value: 'monday', label: 'Monday' },
            { value: 'sunday', label: 'Sunday' },
          ]}
        />
        <SelectRow
          label="Date Format"
          subtext="Short dates in lists and feeds"
          value={dateFormat}
          onChange={value => savePref('date_format', value)}
          options={[
            { value: 'day-month', label: '5 Mar' },
            { value: 'month-day', label: 'Mar 5' },
          ]}
        />
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Reset All Settings</div>
            <div className={styles.subtext}>Type RESET to restore default settings</div>
          </div>
          <div className={styles.inlineControls}>
            <input
              className={styles.confirmInput}
              value={resetConfirm}
              onChange={event => setResetConfirm(event.target.value)}
              placeholder="RESET"
              aria-label="Type RESET to confirm settings reset"
            />
            <button
              type="button"
              className={styles.button}
              disabled={resetConfirm !== 'RESET'}
              onClick={resetSettings}
            >
              <RotateCcw size={14} /> Reset
            </button>
          </div>
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
            <span className={styles.mono}>Connected</span>
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
          {!isDemo && <button onClick={triggerSync} className={styles.button}>Sync Now</button>}
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

      {isDemo ? (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Backup & Restore</h3>
          <div className={styles.subtext}>Not available in the demo — self-host ErgDash to back up and restore your own data.</div>
        </div>
      ) : (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Backup & Restore</h3>
          <div className={styles.row}>
            <div>
              <div className={styles.label}>Backup & Export</div>
              <div className={styles.subtext}>Download a full SQLite snapshot or streamed JSON export</div>
            </div>
            <div className={styles.inlineControls}>
              <a href="/api/admin/backup" className={styles.button}>
                <Download size={14} /> Backup
              </a>
              <a href="/api/admin/export" className={styles.button}>
                <FileJson size={14} /> Export JSON
              </a>
            </div>
          </div>
          <form className={styles.restoreBox} onSubmit={restoreDatabase}>
            <div>
              <div className={styles.label}>Restore Database</div>
              <div className={styles.warningText}>
                Current data will be replaced. The server keeps a safety copy named ergdash.db.pre-restore.sqlite3 before swapping files.
              </div>
            </div>
            <div className={styles.restoreControls}>
              <input
                className={styles.fileInput}
                type="file"
                accept=".sqlite3,.sqlite,.db"
                onChange={event => setRestoreFile(event.target.files?.[0] || null)}
                aria-label="Choose SQLite database backup"
              />
              <input
                className={styles.confirmInput}
                value={restoreConfirm}
                onChange={event => setRestoreConfirm(event.target.value)}
                placeholder="RESTORE"
                aria-label="Type RESTORE to confirm database restore"
              />
              <button
                type="submit"
                className={`${styles.button} ${styles.buttonDanger}`}
                disabled={!restoreFile || restoreConfirm !== 'RESTORE' || restoreBusy}
              >
                <Upload size={14} /> {restoreBusy ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          </form>
        </div>
      )}

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

      {isDemo ? (
        <div className={`${styles.section} ${styles.dangerSection}`}>
          <h3 className={styles.sectionTitle}>Danger Zone</h3>
          <div className={styles.subtext}>Not available in the demo — self-host ErgDash to manage your own Concept2 connection.</div>
        </div>
      ) : (
        <div className={`${styles.section} ${styles.dangerSection}`}>
          <h3 className={styles.sectionTitle}>Danger Zone</h3>
          <div className={styles.row}>
            <div>
              <div className={styles.label}>Disconnect Concept2 Account</div>
              <div className={styles.subtext}>Type DISCONNECT to remove OAuth tokens and end this session</div>
            </div>
            <div className={styles.inlineControls}>
              <input
                className={styles.confirmInput}
                value={dangerConfirm}
                onChange={event => setDangerConfirm(event.target.value)}
                placeholder="DISCONNECT"
                aria-label="Type DISCONNECT to confirm account disconnect"
              />
              <button
                type="button"
                className={`${styles.button} ${styles.buttonDanger}`}
                disabled={dangerConfirm !== 'DISCONNECT' || dangerBusy === 'disconnect'}
                onClick={disconnectAccount}
              >
                <LogOut size={14} /> Disconnect
              </button>
            </div>
          </div>
          <div className={styles.row}>
            <div>
              <div className={styles.label}>Wipe Local Data & Re-sync</div>
              <div className={styles.subtext}>Type WIPE to clear local workout data and start a fresh sync</div>
            </div>
            <div className={styles.inlineControls}>
              <input
                className={styles.confirmInput}
                value={wipeConfirm}
                onChange={event => setWipeConfirm(event.target.value)}
                placeholder="WIPE"
                aria-label="Type WIPE to confirm local data wipe"
              />
              <button
                type="button"
                className={`${styles.button} ${styles.buttonDanger}`}
                disabled={wipeConfirm !== 'WIPE' || dangerBusy === 'wipe'}
                onClick={wipeLocalData}
              >
                <Trash2 size={14} /> Wipe
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
