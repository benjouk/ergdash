import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { usePrefs } from '../context/PrefsContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useUnits } from '../context/UnitsContext.jsx';
import { monthGrid, shiftMonth, monthLabel, weekdayLabels } from '../utils/planCalendar.js';
import { parsePaceInput, parseTimeInput, formatPaceSeconds, formatDuration } from '../utils/ergMath.js';
import styles from './Plan.module.css';

const PLAN_TYPES = [
  ['steady', 'Steady'],
  ['intervals', 'Intervals'],
  ['test', 'Test'],
  ['race', 'Race'],
  ['other', 'Other'],
];

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function planSummary(plan, formatDistance) {
  if (plan.target_distance) return formatDistance(plan.target_distance);
  if (plan.target_duration_ms) return formatDuration(plan.target_duration_ms / 1000, 0);
  return plan.type;
}

const EMPTY_FORM = {
  type: 'steady', distance: '', duration: '', pace: '', rate: '', notes: '',
};

function formFromPlan(plan) {
  return {
    type: plan.type,
    distance: plan.target_distance ? String(plan.target_distance) : '',
    duration: plan.target_duration_ms ? formatDuration(plan.target_duration_ms / 1000, 0) : '',
    pace: plan.target_pace_ms ? formatPaceSeconds(plan.target_pace_ms / 1000) : '',
    rate: plan.target_rate ? String(plan.target_rate) : '',
    notes: plan.notes || '',
  };
}

export default function Plan() {
  const today = isoToday();
  const [{ year, month }, setYearMonth] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  const { weekStart } = usePrefs();
  const { formatDistance, formatPace } = useUnits();
  const toast = useToast();

  const [plans, setPlans] = useState(null);
  const [actualDays, setActualDays] = useState([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [editingId, setEditingId] = useState(null); // plan id, 'new', or null
  const [form, setForm] = useState(EMPTY_FORM);

  const grid = useMemo(() => monthGrid(year, month, weekStart), [year, month, weekStart]);

  const load = useCallback(() => {
    api.getPlans({ from: grid.from, to: grid.to })
      .then(d => setPlans(d.plans || []))
      .catch(() => setPlans([]));
    api.getCalendar({ from: grid.from, to: grid.to })
      .then(d => setActualDays(d.days || []))
      .catch(() => setActualDays([]));
  }, [grid.from, grid.to]);

  useEffect(() => { load(); }, [load]);

  const plansByDay = useMemo(() => {
    const map = new Map();
    for (const p of plans || []) {
      if (!map.has(p.date)) map.set(p.date, []);
      map.get(p.date).push(p);
    }
    return map;
  }, [plans]);

  const metersByDay = useMemo(() => {
    const map = new Map(actualDays.map(d => [d.date, d]));
    const max = Math.max(1, ...actualDays.map(d => d.meters));
    return { map, max };
  }, [actualDays]);

  const dayPlans = plansByDay.get(selectedDate) || [];
  const dayActual = metersByDay.map.get(selectedDate);

  const startEdit = (plan) => {
    setEditingId(plan ? plan.id : 'new');
    setForm(plan ? formFromPlan(plan) : EMPTY_FORM);
  };

  const closeEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const submit = (event) => {
    event.preventDefault();
    const payload = { type: form.type };

    const distance = Math.round(Number(form.distance));
    payload.target_distance = Number.isFinite(distance) && distance > 0 ? distance : null;

    const durationS = parseTimeInput(form.duration);
    payload.target_duration_ms = durationS ? Math.round(durationS * 1000) : null;

    if (!payload.target_distance && !payload.target_duration_ms) {
      toast.error('Set a target distance or duration');
      return;
    }

    const paceS = parsePaceInput(form.pace);
    payload.target_pace_ms = paceS ? Math.round(paceS * 1000) : null;

    const rate = Math.round(Number(form.rate));
    payload.target_rate = Number.isFinite(rate) && rate > 0 ? rate : null;

    payload.notes = form.notes.trim() || null;

    const request = editingId === 'new'
      ? api.createPlan({ ...payload, date: selectedDate })
      : api.updatePlan(editingId, payload);

    request
      .then(() => { toast.success('Plan saved'); closeEdit(); load(); })
      .catch(err => toast.error(err.message || 'Could not save plan'));
  };

  const remove = (plan) => {
    api.deletePlan(plan.id)
      .then(() => { toast.success('Plan removed'); closeEdit(); load(); })
      .catch(err => toast.error(err.message || 'Could not remove plan'));
  };

  const setStatus = (plan, status) => {
    api.updatePlan(plan.id, { status })
      .then(() => load())
      .catch(err => toast.error(err.message || 'Could not update plan'));
  };

  return (
    <div className={styles.plan}>
      <div className={styles.header}>
        <h2 className={styles.title}>Plan</h2>
        <div className={styles.monthNav}>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Previous month"
            onClick={() => setYearMonth(shiftMonth(year, month, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <span className={styles.monthLabel}>{monthLabel(year, month)}</span>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Next month"
            onClick={() => setYearMonth(shiftMonth(year, month, 1))}
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className={styles.todayButton}
            onClick={() => {
              setYearMonth({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
              setSelectedDate(today);
            }}
          >
            Today
          </button>
        </div>
      </div>

      <div className={styles.calendarCard}>
        <div className={styles.weekdayRow}>
          {weekdayLabels(weekStart).map(label => (
            <div key={label} className={styles.weekdayLabel}>{label}</div>
          ))}
        </div>
        {grid.weeks.map((week, wi) => (
          <div key={wi} className={styles.weekRow}>
            {week.map(cell => {
              const entry = metersByDay.map.get(cell.date);
              const cellPlans = plansByDay.get(cell.date) || [];
              const intensity = entry ? 0.15 + 0.45 * (entry.meters / metersByDay.max) : 0;
              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => { setSelectedDate(cell.date); closeEdit(); }}
                  className={[
                    styles.dayCell,
                    cell.inMonth ? '' : styles.dayOutside,
                    cell.date === today ? styles.dayToday : '',
                    cell.date === selectedDate ? styles.daySelected : '',
                  ].join(' ')}
                  aria-label={`${cell.date}${entry ? `, ${entry.meters.toLocaleString()}m rowed` : ''}${cellPlans.length ? `, ${cellPlans.length} planned` : ''}`}
                >
                  {intensity > 0 && (
                    <span className={styles.dayFill} style={{ opacity: intensity }} aria-hidden="true" />
                  )}
                  <span className={styles.dayNumber}>{Number(cell.date.slice(8, 10))}</span>
                  {entry && (
                    <span className={styles.dayMeters}>{formatDistance(entry.meters)}</span>
                  )}
                  <span className={styles.dayChips}>
                    {cellPlans.map(p => (
                      <span key={p.id} className={`${styles.chip} ${styles[`chip_${p.adherence}`] || ''}`}>
                        <span className={styles.chipText}>
                          {p.type} {planSummary(p, formatDistance)}
                        </span>
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        <div className={styles.legend}>
          <span className={`${styles.chip} ${styles.chip_planned}`}><span className={styles.chipText}>planned</span></span>
          <span className={`${styles.chip} ${styles.chip_completed}`}><span className={styles.chipText}>completed</span></span>
          <span className={`${styles.chip} ${styles.chip_missed}`}><span className={styles.chipText}>missed</span></span>
          <span className={`${styles.chip} ${styles.chip_skipped}`}><span className={styles.chipText}>skipped</span></span>
        </div>
      </div>

      <div className={styles.dayPanel}>
        <div className={styles.dayPanelHeader}>
          <h3 className={styles.dayPanelTitle}>
            {new Date(`${selectedDate}T00:00:00Z`).toLocaleDateString('en-GB', {
              weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
            })}
          </h3>
          {editingId == null && (
            <button type="button" className={styles.addButton} onClick={() => startEdit(null)}>
              <Plus size={14} /> Add session
            </button>
          )}
        </div>

        {dayActual && (
          <div className={styles.dayActual}>
            Rowed {dayActual.meters.toLocaleString()}m in {dayActual.sessions} session{dayActual.sessions === 1 ? '' : 's'}
          </div>
        )}

        {dayPlans.length === 0 && editingId == null && (
          <div className={styles.dayEmpty}>Nothing planned. Add a session to build your week.</div>
        )}

        {dayPlans.map(plan => (
          <div key={plan.id} className={styles.planRow}>
            <div className={styles.planRowMain}>
              <span className={`${styles.chip} ${styles[`chip_${plan.adherence}`] || ''}`}>
                <span className={styles.chipText}>{plan.adherence}</span>
              </span>
              <span className={styles.planRowTitle}>
                {PLAN_TYPES.find(([v]) => v === plan.type)?.[1] || plan.type}
                {' · '}
                {planSummary(plan, formatDistance)}
                {plan.target_pace_ms ? ` @ ${formatPace(plan.target_pace_ms)}` : ''}
                {plan.target_rate ? ` · ${plan.target_rate}spm` : ''}
              </span>
            </div>
            {plan.notes && <div className={styles.planRowNotes}>{plan.notes}</div>}
            {plan.workout && (
              <div className={styles.planRowLinked}>
                Completed by{' '}
                <Link to={`/session/${plan.workout.id}`} className={styles.sessionLink}>
                  {formatDistance(plan.workout.distance)} session
                </Link>
                {plan.workout.pace_ms ? ` at ${formatPace(plan.workout.pace_ms)}` : ''}
                {plan.match_type === 'auto' ? ' (auto-matched)' : ''}
              </div>
            )}
            <div className={styles.planRowActions}>
              <button type="button" className={styles.smallButton} onClick={() => startEdit(plan)}>Edit</button>
              {plan.status === 'planned' && (
                <button type="button" className={styles.smallButton} onClick={() => setStatus(plan, 'skipped')}>
                  Skip
                </button>
              )}
              {plan.status === 'skipped' && (
                <button type="button" className={styles.smallButton} onClick={() => setStatus(plan, 'planned')}>
                  Unskip
                </button>
              )}
            </div>
          </div>
        ))}

        {editingId != null && (
          <form className={styles.form} onSubmit={submit}>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Type</span>
                <select
                  className={styles.input}
                  value={form.type}
                  onChange={e => setForm({ ...form, type: e.target.value })}
                >
                  {PLAN_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Distance (m)</span>
                <input
                  type="number"
                  min="0"
                  step="500"
                  className={styles.input}
                  value={form.distance}
                  placeholder="10000"
                  onChange={e => setForm({ ...form, distance: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>or Duration</span>
                <input
                  className={styles.input}
                  value={form.duration}
                  placeholder="45:00"
                  onChange={e => setForm({ ...form, duration: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Pace /500m</span>
                <input
                  className={styles.input}
                  value={form.pace}
                  placeholder="2:02"
                  onChange={e => setForm({ ...form, pace: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Rate (spm)</span>
                <input
                  type="number"
                  min="0"
                  max="60"
                  className={styles.input}
                  value={form.rate}
                  placeholder="22"
                  onChange={e => setForm({ ...form, rate: e.target.value })}
                />
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <textarea
                className={`${styles.input} ${styles.notesInput}`}
                value={form.notes}
                rows={2}
                placeholder="Session intent, splits, warm-up..."
                onChange={e => setForm({ ...form, notes: e.target.value })}
              />
            </label>
            <div className={styles.formActions}>
              <button type="submit" className={`${styles.smallButton} ${styles.primaryButton}`}>
                {editingId === 'new' ? 'Add plan' : 'Save changes'}
              </button>
              <button type="button" className={styles.smallButton} onClick={closeEdit}>Cancel</button>
              {editingId !== 'new' && (
                <button
                  type="button"
                  className={`${styles.smallButton} ${styles.dangerButton}`}
                  onClick={() => remove(dayPlans.find(p => p.id === editingId))}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
