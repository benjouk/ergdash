import { useState } from 'react';
import { CalendarDays, ChevronsRight, Pause, Play, CalendarCog, Settings2, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { usePrefs } from '../../context/PrefsContext.jsx';
import DayPicker from './DayPicker.jsx';
import btn from '../ui/Button.module.css';
import styles from './ProgramCard.module.css';

// Vertical fill for one week: green for completed, red for missed, neutral for
// what's still upcoming.
function weekFill(wk) {
  const done = wk.total ? wk.completed / wk.total : 0;
  const miss = wk.total ? wk.missed / wk.total : 0;
  const a = done * 100;
  const b = (done + miss) * 100;
  return `linear-gradient(to top, var(--positive) 0 ${a}%, var(--negative) ${a}% ${b}%, var(--surface-alt) ${b}% 100%)`;
}

// Active-program summary with its management actions (move schedule, pause/
// resume, training days, type-to-confirm delete) behind a Manage disclosure.
export default function ProgramCard({ program, onChanged }) {
  const toast = useToast();
  const { weekStart } = usePrefs();
  const [busy, setBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [editDays, setEditDays] = useState(null); // array | null
  const [confirm, setConfirm] = useState(null); // '' | null

  const { progress, status } = program;
  const paused = status === 'paused';

  const run = (promise, okMsg) => {
    setBusy(true);
    promise
      .then(() => { if (okMsg) toast.success(okMsg); onChanged(); })
      .catch(err => toast.error(err.message || 'Could not update program'))
      .finally(() => setBusy(false));
  };

  const saveDays = () => {
    if (editDays.length !== program.training_days.length) {
      toast.error(`Pick ${program.training_days.length} training days`);
      return;
    }
    run(api.updateProgram(program.id, { training_days: editDays }), 'Training days updated');
    setEditDays(null);
  };

  const doDelete = () => {
    run(api.deleteProgram(program.id), 'Program removed');
    setConfirm(null);
  };

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>
          <CalendarDays size={18} /> {program.name}
        </h3>
        <span className={`${styles.status} ${paused ? styles.statusPaused : ''}`}>
          {paused ? 'Paused' : 'Active'}
        </span>
      </div>

      <div>
        <div className={styles.weekLabel}>
          Week <strong>{Math.min(progress.current_week + 1, progress.total_weeks)}</strong> of {progress.total_weeks}
        </div>
        <div className={styles.summary}>
          <span><b>{progress.sessions.completed}</b> completed · <b>{progress.sessions.upcoming}</b> remaining</span>
        </div>
      </div>

      <div className={styles.track} role="img" aria-label={`${progress.sessions.completed} of ${progress.sessions.total} sessions completed`}>
        {progress.weeks.map(wk => (
          <div
            key={wk.week}
            className={`${styles.week} ${wk.week === progress.current_week ? styles.weekCurrent : ''}`}
            style={{ background: weekFill(wk) }}
            title={`Week ${wk.week + 1}: ${wk.completed}/${wk.total} done`}
          />
        ))}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={`${btn.button} ${btn.buttonSmall}`}
          onClick={() => {
            setManageOpen(open => !open);
            setEditDays(null);
            setConfirm(null);
          }}
          aria-expanded={manageOpen}
        >
          <Settings2 size={14} /> Manage plan
        </button>
      </div>

      {manageOpen && (
        <div className={styles.manage}>
          {editDays ? (
            <>
              <span className={styles.editLabel}>Training days ({program.training_days.length})</span>
              <DayPicker value={editDays} onChange={setEditDays} weekStart={weekStart} max={program.training_days.length} />
              <div className={styles.actions}>
                <button type="button" className={`${btn.button} ${btn.buttonPrimary} ${btn.buttonSmall}`} onClick={saveDays} disabled={busy}>Save days</button>
                <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => setEditDays(null)}>Cancel</button>
              </div>
            </>
          ) : confirm !== null ? (
            <div className={styles.confirmRow}>
              <span className={styles.editLabel}>Type DELETE to remove this program and its upcoming sessions</span>
              <input
                className={styles.confirmInput}
                value={confirm}
                placeholder="DELETE"
                onChange={e => setConfirm(e.target.value)}
              />
              <button
                type="button"
                className={`${btn.button} ${btn.buttonDanger} ${btn.buttonSmall}`}
                disabled={confirm !== 'DELETE' || busy}
                onClick={doDelete}
              >
                <Trash2 size={13} /> Confirm
              </button>
              <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          ) : (
            <div className={styles.actions}>
              <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => run(api.shiftProgram(program.id, 1), 'Schedule moved a week')} disabled={busy}>
                <ChevronsRight size={14} /> Move schedule
              </button>
              {paused ? (
                <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => run(api.updateProgram(program.id, { status: 'active' }), 'Program resumed')} disabled={busy}>
                  <Play size={14} /> Resume
                </button>
              ) : (
                <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => run(api.updateProgram(program.id, { status: 'paused' }), 'Program paused')} disabled={busy}>
                  <Pause size={14} /> Pause
                </button>
              )}
              <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => setEditDays(program.training_days)}>
                <CalendarCog size={14} /> Training days
              </button>
              <span className={styles.spacer} />
              <button type="button" className={`${btn.button} ${btn.buttonDanger} ${btn.buttonSmall}`} onClick={() => setConfirm('')}>
                <Trash2 size={13} /> Delete program
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
