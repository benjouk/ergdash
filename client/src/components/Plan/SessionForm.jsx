import { useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  PLAN_TYPES, SESSION_PRESETS, REPEAT_OPTIONS, EMPTY_FORM,
  formFromPlan, formToPayload,
} from './planFormat.js';
import btn from '../ui/Button.module.css';
import styles from './SessionForm.module.css';

// Add or edit a single planned session. Owns its own form state; calls
// onSaved() after a successful create/update so the parent can refetch.
// Deletion lives on the plan row (PlanRow), not here.
export default function SessionForm({ plan, date, onSaved, onCancel }) {
  const isNew = !plan;
  const toast = useToast();
  const [form, setForm] = useState(() => (plan ? formFromPlan(plan) : EMPTY_FORM));
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const submit = (event) => {
    event.preventDefault();
    const { payload, error } = formToPayload(form);
    if (error) { toast.error(error); return; }

    const repeatWeeks = isNew ? Math.round(Number(form.repeat)) || 0 : 0;
    const request = isNew
      ? api.createPlan({ ...payload, date, ...(repeatWeeks > 0 ? { repeat_weeks: repeatWeeks } : {}) })
      : api.updatePlan(plan.id, payload);

    setBusy(true);
    request
      .then(() => {
        toast.success(repeatWeeks > 0 ? `Plan saved for ${repeatWeeks + 1} weeks` : 'Plan saved');
        onSaved();
      })
      .catch(err => toast.error(err.message || 'Could not save plan'))
      .finally(() => setBusy(false));
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Preset</span>
          <select
            className={styles.input}
            value=""
            onChange={e => {
              const preset = SESSION_PRESETS[Number(e.target.value)];
              if (preset) set({ ...EMPTY_FORM, ...preset.form, notes: form.notes, repeat: form.repeat });
            }}
          >
            <option value="">Choose a session…</option>
            {SESSION_PRESETS.map((preset, index) => (
              <option key={preset.label} value={index}>{preset.label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Type</span>
          <select className={styles.input} value={form.type} onChange={e => set({ type: e.target.value })}>
            {PLAN_TYPES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {form.type === 'intervals' ? (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Reps</span>
              <input
                type="number" min="0" max="50" className={styles.input}
                value={form.reps} placeholder="4"
                onChange={e => set({ reps: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Rep distance (m)</span>
              <input
                type="number" min="0" step="250" className={styles.input}
                value={form.repDistance} placeholder="2000"
                onChange={e => set({ repDistance: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>or Rep time</span>
              <input
                className={styles.input} value={form.repDuration} placeholder="10:00"
                onChange={e => set({ repDuration: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Rest</span>
              <input
                className={styles.input} value={form.rest} placeholder="5:00"
                onChange={e => set({ rest: e.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Distance (m)</span>
              <input
                type="number" min="0" step="500" className={styles.input}
                value={form.distance} placeholder="10000"
                onChange={e => set({ distance: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>or Duration</span>
              <input
                className={styles.input} value={form.duration} placeholder="45:00"
                onChange={e => set({ duration: e.target.value })}
              />
            </label>
          </>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Pace /500m</span>
          <input
            className={styles.input} value={form.pace} placeholder="2:02"
            onChange={e => set({ pace: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Rate (spm)</span>
          <input
            type="number" min="0" max="60" className={styles.input}
            value={form.rate} placeholder="22"
            onChange={e => set({ rate: e.target.value })}
          />
        </label>
        {isNew && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Repeat</span>
            <select className={styles.input} value={form.repeat} onChange={e => set({ repeat: e.target.value })}>
              {REPEAT_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Notes</span>
        <textarea
          className={`${styles.input} ${styles.notesInput}`}
          value={form.notes} rows={2}
          placeholder="Session intent, splits, warm-up..."
          onChange={e => set({ notes: e.target.value })}
        />
      </label>
      <div className={styles.formActions}>
        <button type="submit" className={`${btn.button} ${btn.buttonPrimary} ${btn.buttonSmall}`} disabled={busy}>
          {isNew ? 'Add plan' : 'Save changes'}
        </button>
        <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
