import { useState, useEffect } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePrefs } from '../../context/PrefsContext.jsx';
import { useUnits } from '../../context/UnitsContext.jsx';
import { planSummary, PLAN_TYPE_LABELS } from './planFormat.js';
import DayPicker from './DayPicker.jsx';
import btn from '../ui/Button.module.css';
import styles from './ProgramBrowser.module.css';

const DAY_MS = 86400000;

const isoToday = () => new Date().toISOString().slice(0, 10);
const weekdayOf = (iso) => (new Date(Date.parse(iso)).getUTCDay() + 6) % 7;

// The earliest date on/after `fromIso` whose weekday is in `days`.
function nextTrainingDay(fromIso, days) {
  if (!days.length) return fromIso;
  const base = Date.parse(fromIso);
  for (let i = 0; i < 7; i++) {
    const iso = new Date(base + i * DAY_MS).toISOString().slice(0, 10);
    if (days.includes(weekdayOf(iso))) return iso;
  }
  return fromIso;
}

function StartProgramForm({ preset, onStarted }) {
  const toast = useToast();
  const { weekStart } = usePrefs();
  const { formatDistance } = useUnits();
  const isRace = preset.kind === 'race';
  const isCycle = preset.kind === 'cycle';

  const [days, setDays] = useState([]);
  const [startDate, setStartDate] = useState(isoToday());
  const [raceDate, setRaceDate] = useState('');
  const [duration, setDuration] = useState(isCycle ? preset.defaultWeeks : preset.weeks.length);
  const [busy, setBusy] = useState(false);

  // Keep the start date on a training day as the selection changes.
  const setDaysAndSnap = (next) => {
    setDays(next);
    if (!isRace) setStartDate(prev => nextTrainingDay(prev < isoToday() ? isoToday() : prev, next));
  };

  const durationOptions = [];
  if (isCycle) {
    for (let w = preset.minWeeks; w <= preset.maxWeeks; w += preset.cycleWeeks) durationOptions.push(w);
  }

  const submit = (event) => {
    event.preventDefault();
    if (days.length !== preset.sessionsPerWeek) {
      toast.error(`Pick ${preset.sessionsPerWeek} training days`);
      return;
    }
    const body = { preset_id: preset.id, training_days: days };
    if (isRace) {
      if (!raceDate) { toast.error('Choose a race date'); return; }
      body.race_date = raceDate;
    } else {
      if (!days.includes(weekdayOf(startDate))) {
        toast.error('Start date must be one of your training days');
        return;
      }
      body.start_date = startDate;
      if (isCycle) body.duration_weeks = duration;
    }
    setBusy(true);
    api.createProgram(body)
      .then(() => { toast.success(`${preset.name} started`); onStarted(); })
      .catch(err => toast.error(err.message || 'Could not start program'))
      .finally(() => setBusy(false));
  };

  // Rough preview of when a race block begins (server computes the exact date).
  const racePreviewStart = raceDate
    ? new Date(Date.parse(raceDate) - (preset.weeks.length - 1) * 7 * DAY_MS).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    : null;

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Training days — pick {preset.sessionsPerWeek}</span>
        <DayPicker value={days} onChange={setDaysAndSnap} weekStart={weekStart} max={preset.sessionsPerWeek} />
      </div>

      {isRace ? (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Race date</span>
          <input type="date" className={styles.input} value={raceDate} min={isoToday()} onChange={e => setRaceDate(e.target.value)} />
          {racePreviewStart && (
            <span className={styles.hint}>{preset.weeks.length}-week block, starting around {racePreviewStart}.</span>
          )}
        </div>
      ) : (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Start date</span>
          <input type="date" className={styles.input} value={startDate} min={isoToday()} onChange={e => setStartDate(e.target.value)} />
          <span className={styles.hint}>Must fall on one of your training days.</span>
        </div>
      )}

      {isCycle && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Length</span>
          <select className={styles.input} value={duration} onChange={e => setDuration(Number(e.target.value))}>
            {durationOptions.map(w => <option key={w} value={w}>{w} weeks</option>)}
          </select>
        </div>
      )}

      <div className={styles.actions}>
        <button type="submit" className={`${btn.button} ${btn.buttonPrimary} ${btn.buttonSmall}`} disabled={busy}>
          <CalendarPlus size={14} /> Start program
        </button>
      </div>
    </form>
  );
}

function WeekTable({ preset, formatDistance }) {
  return (
    <div className={styles.weekTable}>
      {preset.weeks.map((week, i) => (
        <div key={i} className={styles.weekRow}>
          <span className={styles.weekName}>
            {preset.kind === 'cycle' ? `Cycle ${i + 1}` : `Week ${i + 1}`}
          </span>
          <div className={styles.weekSessions}>
            {week.sessions.map((s, j) => (
              <span key={j} className={styles.sessionPill}>
                {PLAN_TYPE_LABELS[s.type] || s.type} {planSummary(s, formatDistance)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Catalogue of preset programs shown when nothing is in progress. Expanding a
// preset reveals its week-by-week structure and the start form.
export default function ProgramBrowser({ onStarted }) {
  const { formatDistance } = useUnits();
  const [presets, setPresets] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.getProgramPresets().then(d => setPresets(d.presets || [])).catch(() => setPresets([]));
  }, []);

  if (!presets) return null;

  return (
    <div className={styles.browser}>
      <div className={styles.sectionTitle}>Training programs</div>
      <p className={styles.intro}>
        Start a structured plan and its sessions fill your calendar automatically. Pick one to see the week-by-week build.
      </p>
      <div className={styles.presets}>
        {presets.map(preset => {
          const weeksLabel = preset.kind === 'cycle'
            ? `${preset.minWeeks}–${preset.maxWeeks} wks`
            : `${preset.weeks.length} wks`;
          const active = expanded === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={`${styles.preset} ${active ? styles.presetActive : ''}`}
              onClick={() => setExpanded(active ? null : preset.id)}
            >
              <span className={styles.presetName}>{preset.name}</span>
              <span className={styles.presetMeta}>{weeksLabel} · {preset.sessionsPerWeek}/wk</span>
              <span className={styles.presetDesc}>{preset.description}</span>
            </button>
          );
        })}
      </div>

      {expanded && (() => {
        const preset = presets.find(p => p.id === expanded);
        return (
          <div className={styles.detail}>
            <WeekTable preset={preset} formatDistance={formatDistance} />
            <StartProgramForm preset={preset} onStarted={onStarted} />
          </div>
        );
      })()}
    </div>
  );
}
