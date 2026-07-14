import { useState, useEffect, useCallback } from 'react';
import { Download, FileJson, LogOut, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { parseTimeInput, formatDuration } from '../utils/ergMath.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { useUnits } from '../context/UnitsContext.jsx';
import { useSync } from '../context/SyncContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { usePrefs } from '../context/PrefsContext.jsx';
import { useTimeRange } from '../context/TimeRangeContext.jsx';
import Segmented from '../components/ui/Segmented.jsx';
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
                : 'No HR data yet - enter it manually'}
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
                // Z5 always tops out at 100% of max - show it, don't edit it.
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

function AthleteSection() {
  const { weightKg, updatePref } = usePrefs();
  const [weight, setWeight] = useState('');
  const toast = useToast();

  useEffect(() => {
    setWeight(weightKg ? String(weightKg) : '');
  }, [weightKg]);

  const save = () => {
    const parsed = Number(weight);
    const valid = weight === '' || (Number.isFinite(parsed) && parsed > 0);
    if (!valid) return;
    if ((weightKg || '') === (parsed || '')) return;
    updatePref('weight_kg', weight === '' ? '' : parsed)
      .then(() => toast.success('Settings saved'))
      .catch(err => toast.error(err.message || 'Could not save settings'));
  };

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Athlete</h3>
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Body Weight</div>
          <div className={styles.subtext}>
            Enables weight-adjusted paces on personal bests and in Tools - leave empty to disable
          </div>
        </div>
        <input
          type="number"
          min="30"
          max="200"
          step="0.5"
          value={weight}
          placeholder="kg"
          onChange={e => setWeight(e.target.value)}
          onBlur={save}
          aria-label="Body weight in kilograms"
          className={styles.numberInput}
        />
      </div>
    </div>
  );
}

const VOLUME_PERIODS = [
  ['weekly', 'Weekly Metres', 'Target metres per week'],
  ['monthly', 'Monthly Metres', 'Target metres per calendar month'],
  ['season', 'Season Metres', 'Target metres since May 1'],
  ['year', 'Annual Metres', 'Target metres this calendar year'],
];

const TARGET_DISTANCES = [
  [500, '500m'], [1000, '1k'], [2000, '2k'], [5000, '5k'],
  [6000, '6k'], [10000, '10k'], [21097, 'Half Marathon'], [42195, 'Marathon'],
];

function GoalsSection() {
  const [goals, setGoals] = useState(null);
  const [volumeInputs, setVolumeInputs] = useState({});
  const [newTarget, setNewTarget] = useState({ distance: '2000', time: '', raceDate: '', label: '' });
  const toast = useToast();

  const load = useCallback(() => {
    return api.getGoals().then(d => {
      const list = d.goals || [];
      setGoals(list);
      const inputs = {};
      for (const g of list) {
        if (g.kind === 'volume' && g.active) inputs[g.period] = String(g.target_meters);
      }
      setVolumeInputs(inputs);
    }).catch(() => setGoals([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = (promise, message = 'Goal saved') => promise
    .then(() => { toast.success(message); return load(); })
    .catch(err => toast.error(err.message || 'Could not save goal'));

  const saveVolume = (period) => {
    const existing = goals?.find(g => g.kind === 'volume' && g.period === period && g.active);
    const meters = Math.round(Number(volumeInputs[period]));
    const hasValue = Number.isFinite(meters) && meters > 0;

    if (existing && !hasValue && volumeInputs[period] !== undefined) {
      run(api.deleteGoal(existing.id), 'Goal removed');
    } else if (existing && hasValue && meters !== existing.target_meters) {
      run(api.updateGoal(existing.id, { target_meters: meters }));
    } else if (!existing && hasValue) {
      run(api.createGoal({ kind: 'volume', period, target_meters: meters }));
    }
  };

  const addTarget = () => {
    const seconds = parseTimeInput(newTarget.time);
    if (!seconds) {
      toast.error('Enter a target time like 7:20 or 19:45.5');
      return;
    }
    const payload = {
      kind: 'performance',
      distance: Number(newTarget.distance),
      target_time_ms: Math.round(seconds * 1000),
    };
    if (newTarget.raceDate) payload.race_date = newTarget.raceDate;
    if (newTarget.label.trim()) payload.label = newTarget.label.trim();
    run(api.createGoal(payload), 'Target added')
      .then(() => setNewTarget({ distance: '2000', time: '', raceDate: '', label: '' }));
  };

  const patchTarget = (goal, field, value) => {
    run(api.updateGoal(goal.id, { [field]: value }));
  };

  const performanceGoals = (goals || []).filter(g => g.kind === 'performance' && g.active);

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Goals & Targets</h3>

      {VOLUME_PERIODS.map(([period, label, subtext]) => (
        <div className={styles.row} key={period}>
          <div>
            <div className={styles.label}>{label}</div>
            <div className={styles.subtext}>{subtext} - leave empty for none</div>
          </div>
          <input
            type="number"
            min="0"
            step="1000"
            className={styles.metersInput}
            value={volumeInputs[period] ?? ''}
            placeholder="metres"
            aria-label={`${label} goal in metres`}
            onChange={e => setVolumeInputs({ ...volumeInputs, [period]: e.target.value })}
            onBlur={() => saveVolume(period)}
          />
        </div>
      ))}

      {performanceGoals.map(goal => (
        <div className={styles.row} key={`${goal.id}:${goal.updated_at || ''}`}>
          <div>
            <div className={styles.label}>
              {TARGET_DISTANCES.find(([d]) => d === goal.distance)?.[1] || `${goal.distance}m`} Target
              {goal.label ? ` · ${goal.label}` : ''}
            </div>
            <div className={styles.subtext}>
              {goal.achieved_at ? 'Achieved - congratulations' : 'Goal time for this distance'}
            </div>
          </div>
          <div className={styles.inlineControls}>
            <input
              className={styles.confirmInput}
              defaultValue={formatDuration(goal.target_time_ms / 1000)}
              aria-label="Target time"
              onBlur={e => {
                const seconds = parseTimeInput(e.target.value);
                const ms = seconds ? Math.round(seconds * 1000) : null;
                if (ms && ms !== goal.target_time_ms) patchTarget(goal, 'target_time_ms', ms);
              }}
            />
            <input
              type="date"
              className={styles.confirmInput}
              defaultValue={goal.race_date || ''}
              aria-label="Race date"
              onBlur={e => {
                const value = e.target.value || null;
                if (value !== goal.race_date) patchTarget(goal, 'race_date', value);
              }}
            />
            <button
              type="button"
              className={styles.button}
              aria-label="Remove target"
              onClick={() => run(api.deleteGoal(goal.id), 'Target removed')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}

      <div className={styles.row}>
        <div>
          <div className={styles.label}>Add Performance Target</div>
          <div className={styles.subtext}>Goal time for a benchmark distance, with an optional race date</div>
        </div>
        <div className={styles.inlineControls}>
          <select
            className={styles.select}
            style={{ minWidth: 110 }}
            value={newTarget.distance}
            aria-label="Target distance"
            onChange={e => setNewTarget({ ...newTarget, distance: e.target.value })}
          >
            {TARGET_DISTANCES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <input
            className={styles.confirmInput}
            value={newTarget.time}
            placeholder="7:20"
            aria-label="Target time"
            onChange={e => setNewTarget({ ...newTarget, time: e.target.value })}
          />
          <input
            type="date"
            className={styles.confirmInput}
            value={newTarget.raceDate}
            aria-label="Race date (optional)"
            onChange={e => setNewTarget({ ...newTarget, raceDate: e.target.value })}
          />
          <input
            className={styles.confirmInput}
            value={newTarget.label}
            placeholder="Label (optional)"
            aria-label="Target label (optional)"
            onChange={e => setNewTarget({ ...newTarget, label: e.target.value })}
          />
          <button type="button" className={styles.button} onClick={addTarget}>
            <Plus size={14} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfilesSection() {
  const { profiles, activeProfile, switchProfile, checkAuth } = useAuth();
  const toast = useToast();
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyId, setBusyId] = useState(null);

  const startRename = (profile) => {
    setRenamingId(profile.id);
    setRenameValue(profile.name);
  };

  const saveRename = async (id) => {
    const name = renameValue.trim();
    if (!name) return setRenamingId(null);
    try {
      await api.renameProfile(id, name);
      toast.success('Profile renamed');
      setRenamingId(null);
      checkAuth();
    } catch (err) {
      toast.error(err.message || 'Rename failed');
    }
  };

  const disconnect = async (profile) => {
    if (!window.confirm(`Disconnect ${profile.name} from Concept2? Their data stays; syncing stops until reconnected.`)) return;
    setBusyId(profile.id);
    try {
      await api.disconnectProfile(profile.id);
      toast.success(`${profile.name} disconnected`);
      checkAuth();
    } catch (err) {
      toast.error(err.message || 'Disconnect failed');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (profile) => {
    if (!window.confirm(`Delete ${profile.name} and ALL their workouts, PBs, goals and plans? This cannot be undone.`)) return;
    setBusyId(profile.id);
    try {
      await api.deleteProfile(profile.id);
      toast.success(`${profile.name} deleted`);
      if (activeProfile?.id === profile.id) {
        switchProfile('');
      } else {
        checkAuth();
      }
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Profiles</h3>
      {profiles.map(profile => (
        <div key={profile.id} className={styles.row}>
          <div>
            {renamingId === profile.id ? (
              <input
                className={styles.textInput || ''}
                value={renameValue}
                autoFocus
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveRename(profile.id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onBlur={() => saveRename(profile.id)}
                aria-label="Profile name"
              />
            ) : (
              <div className={styles.label}>
                {profile.name}
                {activeProfile?.id === profile.id ? ' (active)' : ''}
              </div>
            )}
            <div className={styles.subtext}>
              {profile.connected
                ? `Connected as ${profile.user?.first_name || ''} ${profile.user?.last_name || ''}`.trim()
                : 'Not connected to Concept2'}
            </div>
          </div>
          <div className={styles.rowActions || ''} style={{ display: 'flex', gap: '8px' }}>
            <button className={styles.button} onClick={() => startRename(profile)} disabled={busyId === profile.id}>
              Rename
            </button>
            {profile.connected ? (
              <button className={styles.button} onClick={() => disconnect(profile)} disabled={busyId === profile.id}>
                Disconnect
              </button>
            ) : (
              <a href={`/auth/login?profile=${profile.id}`} className={styles.button}>Reconnect</a>
            )}
            <button
              className={styles.buttonDanger}
              onClick={() => remove(profile)}
              disabled={busyId === profile.id || profiles.length === 1}
              title={profiles.length === 1 ? 'The last profile cannot be deleted' : undefined}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      ))}
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Add a household member</div>
          <div className={styles.subtext}>They sign in with their own Concept2 Logbook account.</div>
        </div>
        <a href="/auth/login?profile=new" className={`${styles.button} ${styles.buttonPrimary}`}>
          <Plus size={14} /> Add profile
        </a>
      </div>
    </div>
  );
}

function formatSyncTime(isoString) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
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
  const { defaultRange, setDefaultRange, PRESETS } = useTimeRange();
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
          label="Default Time Range"
          subtext="Period the selector opens on each visit"
          value={defaultRange}
          onChange={value => setDefaultRange(value)
            .then(() => toast.success('Settings saved'))
            .catch(err => toast.error(err.message || 'Could not save settings'))}
          options={Object.entries(PRESETS).map(([value, label]) => ({ value, label }))}
        />
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

      <AthleteSection />

      <GoalsSection />

      <HrZonesSection />

      {isDemo ? (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Concept2 Connection</h3>
          <div className={styles.row}>
            <div>
              <div className={styles.label}>Status</div>
              <div className={styles.subtext}>
                {user ? `Connected as ${user.first_name} ${user.last_name}` : 'Not connected'}
              </div>
            </div>
            <span className={styles.mono}>Demo</span>
          </div>
        </div>
      ) : (
        <ProfilesSection />
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Sync</h3>
        <div className={styles.row}>
          <div>
            <div className={styles.label}>Status</div>
            <div className={styles.subtext}>
              {syncStatus?.status === 'syncing' ? 'Syncing...' : `Last sync: ${formatSyncTime(syncStatus?.last_completed)}`}
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
            {syncStatus?.enrichment_progress != null ? `${syncStatus.enrichment_progress}%` : '—'}
          </span>
        </div>
      </div>

      {isDemo ? (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Backup & Restore</h3>
          <div className={styles.subtext}>Not available in the demo - self-host ErgDash to back up and restore your own data.</div>
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
          <div className={styles.subtext}>Not available in the demo - self-host ErgDash to manage your own Concept2 connection.</div>
        </div>
      ) : (
        <div className={`${styles.section} ${styles.dangerSection}`}>
          <h3 className={styles.sectionTitle}>Danger Zone</h3>
          <div className={styles.row}>
            <div>
              <div className={styles.label}>Disconnect this profile from Concept2</div>
              <div className={styles.subtext}>Type DISCONNECT to remove this profile&apos;s Concept2 tokens. Your local data and browser session stay.</div>
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
