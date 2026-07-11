import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { parseTimeInput, formatDuration } from '../../utils/ergMath.js';
import {
  EMPTY_FORM, EMPTY_SPLIT, WORKOUT_TYPE_OPTIONS,
  formFromWorkout, formToPayload, diffPayload, formPacePreview, splitTotals,
} from './workoutFormFormat.js';
import btn from '../ui/Button.module.css';
import styles from './WorkoutForm.module.css';

// Manual workout entry (create) and result correction (edit). Owns its form
// state; calls onSaved(workout) after a successful save. In edit mode only
// the changed fields are PATCHed so edited_fields stays minimal on synced
// workouts.
export default function WorkoutForm({ workout, onSaved, onCancel }) {
  const isNew = !workout;
  const toast = useToast();
  const [form, setForm] = useState(() => (workout ? formFromWorkout(workout) : EMPTY_FORM));
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));
  const setSplit = (index, patch) => setForm(prev => ({
    ...prev,
    splits: prev.splits.map((split, i) => (i === index ? { ...split, ...patch } : split)),
  }));
  const addSplit = (type) => setForm(prev => ({
    ...prev,
    splits: [...prev.splits, { ...EMPTY_SPLIT, type }],
  }));
  const removeSplit = (index) => setForm(prev => ({
    ...prev,
    splits: prev.splits.filter((_, i) => i !== index),
  }));

  const pace = formPacePreview(form);
  const totals = useMemo(() => splitTotals(form), [form]);
  const headerDistance = Math.round(Number(form.distance)) || 0;
  const headerTimeS = parseTimeInput(form.duration) || 0;
  const distanceMismatch = form.splits.length > 0 && headerDistance > 0 && totals.distance > 0
    && Math.abs(totals.distance - headerDistance) > Math.max(10, headerDistance * 0.02);
  const timeMismatch = form.splits.length > 0 && headerTimeS > 0 && totals.timeS > 0
    && Math.abs(totals.timeS - headerTimeS) > Math.max(2, headerTimeS * 0.02);

  const submit = (event) => {
    event.preventDefault();
    const { payload, error } = formToPayload(form);
    if (error) { toast.error(error); return; }

    let request;
    if (isNew) {
      request = api.createWorkout(payload);
    } else {
      const diff = diffPayload(payload, workout);
      if (Object.keys(diff).length === 0) {
        toast.info?.('No changes to save');
        onCancel();
        return;
      }
      request = api.updateWorkout(workout.id, diff);
    }

    setBusy(true);
    request
      .then((saved) => {
        (saved.warnings || []).forEach(warning => toast.error(warning));
        toast.success(isNew ? 'Workout added' : 'Workout updated');
        onSaved(saved);
      })
      .catch(err => toast.error(err.message || 'Could not save workout'))
      .finally(() => setBusy(false));
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Date</span>
          <input
            type="date" required className={styles.input}
            value={form.date} onChange={e => set({ date: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Start time</span>
          <input
            type="time" className={styles.input}
            value={form.time} onChange={e => set({ time: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Type</span>
          <select
            className={styles.input} value={form.workoutType}
            onChange={e => set({ workoutType: e.target.value })}
          >
            {WORKOUT_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Distance (m)</span>
          <input
            type="number" min="1" step="1" className={styles.input}
            value={form.distance} placeholder="5000"
            onChange={e => set({ distance: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Time</span>
          <input
            className={styles.input} value={form.duration} placeholder="20:00.0"
            onChange={e => set({ duration: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Rate (spm)</span>
          <input
            type="number" min="10" max="60" step="0.5" className={styles.input}
            value={form.rate} placeholder="22"
            onChange={e => set({ rate: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Avg HR</span>
          <input
            type="number" min="20" max="250" className={styles.input}
            value={form.hrAvg} placeholder="150"
            onChange={e => set({ hrAvg: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Max HR</span>
          <input
            type="number" min="20" max="250" className={styles.input}
            value={form.hrMax} placeholder="172"
            onChange={e => set({ hrMax: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Drag</span>
          <input
            type="number" min="60" max="250" className={styles.input}
            value={form.drag} placeholder="120"
            onChange={e => set({ drag: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Calories</span>
          <input
            type="number" min="0" className={styles.input}
            value={form.calories} placeholder="300"
            onChange={e => set({ calories: e.target.value })}
          />
        </label>
      </div>

      {pace && (
        <div className={styles.pacePreview}>Pace: <strong>{pace}</strong> /500m</div>
      )}

      {isNew && (
        <div className={styles.splits}>
          <div className={styles.splitsHeader}>
            <span className={styles.fieldLabel}>Splits (optional)</span>
            <div className={styles.splitsActions}>
              <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => addSplit('work')}>
                + Work
              </button>
              <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => addSplit('rest')}>
                + Rest
              </button>
            </div>
          </div>
          {form.splits.map((split, index) => (
            <div key={index} className={styles.splitRow}>
              <select
                className={styles.input} value={split.type}
                onChange={e => setSplit(index, { type: e.target.value })}
                aria-label={`Split ${index + 1} type`}
              >
                <option value="work">Work</option>
                <option value="rest">Rest</option>
              </select>
              <input
                type="number" min="0" className={styles.input} placeholder="Meters"
                value={split.distance} aria-label={`Split ${index + 1} distance`}
                onChange={e => setSplit(index, { distance: e.target.value })}
              />
              <input
                className={styles.input} placeholder="Time (2:00.0)"
                value={split.time} aria-label={`Split ${index + 1} time`}
                onChange={e => setSplit(index, { time: e.target.value })}
              />
              <input
                type="number" min="10" max="60" step="0.5" className={styles.input} placeholder="Rate"
                value={split.rate} aria-label={`Split ${index + 1} rate`}
                onChange={e => setSplit(index, { rate: e.target.value })}
              />
              <input
                type="number" min="20" max="250" className={styles.input} placeholder="HR"
                value={split.hr} aria-label={`Split ${index + 1} heart rate`}
                onChange={e => setSplit(index, { hr: e.target.value })}
              />
              <button
                type="button" className={`${btn.button} ${btn.buttonSmall}`}
                onClick={() => removeSplit(index)} aria-label={`Remove split ${index + 1}`}
              >
                ×
              </button>
            </div>
          ))}
          {(distanceMismatch || timeMismatch) && (
            <div className={styles.splitWarning}>
              {distanceMismatch && <span>Work splits sum to {totals.distance}m, workout is {headerDistance}m. </span>}
              {timeMismatch && <span>Work splits sum to {formatDuration(totals.timeS, 0)}, workout is {formatDuration(headerTimeS, 0)}.</span>}
            </div>
          )}
        </div>
      )}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Comments</span>
        <textarea
          className={`${styles.input} ${styles.commentsInput}`}
          value={form.comments} rows={2} maxLength={5000}
          placeholder="Where, how it felt, conditions..."
          onChange={e => set({ comments: e.target.value })}
        />
      </label>

      <div className={styles.formActions}>
        <button type="submit" className={`${btn.button} ${btn.buttonPrimary} ${btn.buttonSmall}`} disabled={busy}>
          {isNew ? 'Add workout' : 'Save changes'}
        </button>
        <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
