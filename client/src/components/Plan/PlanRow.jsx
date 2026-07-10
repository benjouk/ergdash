import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MoreHorizontal, Trash2 } from 'lucide-react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { planSummary, PLAN_TYPE_LABELS } from './planFormat.js';
import AdherenceChip from './AdherenceChip.jsx';
import btn from '../ui/Button.module.css';
import styles from './PlanRow.module.css';

// One planned session with its status actions and inline link-picker.
// `program` (optional) tags the row with its training-program week.
// Common actions stay visible; destructive ones live behind the "…" menu.
export default function PlanRow({
  plan, dayActual, linkedWorkoutIds, program, onEdit, onDelete, onChanged, formatDistance, formatPace,
}) {
  const toast = useToast();
  const [candidates, setCandidates] = useState(null); // workout list or null
  const [confirming, setConfirming] = useState(false); // delete confirm shown?
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const setStatus = (status) => {
    api.updatePlan(plan.id, { status })
      .then(onChanged)
      .catch(err => toast.error(err.message || 'Could not update plan'));
  };

  const unlink = () => {
    api.unmatchPlan(plan.id)
      .then(() => { toast.success('Session unlinked'); onChanged(); })
      .catch(err => toast.error(err.message || 'Could not unlink session'));
  };

  const startLinking = () => {
    const nextDay = new Date(Date.parse(plan.date) + 86400000).toISOString().slice(0, 10);
    api.getWorkouts({ from: plan.date, to: nextDay, limit: 20 })
      .then(d => {
        const options = (d.data || []).filter(w => !linkedWorkoutIds.has(w.id));
        if (options.length === 0) { toast.error('No unlinked sessions on this day'); return; }
        setCandidates(options);
      })
      .catch(err => toast.error(err.message || 'Could not load sessions'));
  };

  const linkWorkout = (workoutId) => {
    api.matchPlan(plan.id, workoutId)
      .then(() => { toast.success('Session linked'); setCandidates(null); onChanged(); })
      .catch(err => toast.error(err.message || 'Could not link session'));
  };

  return (
    <div className={styles.planRow}>
      <div className={styles.planRowMain}>
        <span className={styles.planRowTitle}>
          {PLAN_TYPE_LABELS[plan.type] || plan.type}
          {' · '}
          {planSummary(plan, formatDistance)}
          {plan.target_pace_ms ? ` @ ${formatPace(plan.target_pace_ms)}` : ''}
          {plan.target_rate ? ` · ${plan.target_rate}spm` : ''}
        </span>
        <AdherenceChip adherence={plan.adherence}>{plan.adherence}</AdherenceChip>
      </div>
      {program && (
        <div className={styles.planRowMeta}>
          <span className={styles.programBadge}>
            <CalendarDays size={11} /> {program.name} · Wk {plan.program_week + 1}
          </span>
        </div>
      )}
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
        <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => onEdit(plan)}>Edit</button>
        {plan.workout && (
          <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={unlink}>Unlink</button>
        )}
        {plan.status === 'planned' && dayActual && (
          <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={startLinking}>Link session</button>
        )}
        {plan.status === 'planned' && (
          <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => setStatus('skipped')}>Skip</button>
        )}
        {plan.status === 'skipped' && (
          <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => setStatus('planned')}>Unskip</button>
        )}
        <span className={styles.actionSpacer} />
        <span className={styles.overflowWrapper} ref={menuRef}>
          <button
            type="button"
            className={`${btn.button} ${btn.buttonSmall}`}
            onClick={() => setMenuOpen(open => !open)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className={styles.overflowMenu} role="menu">
              <button
                type="button"
                role="menuitem"
                className={styles.overflowItem}
                onClick={() => { setMenuOpen(false); setConfirming(true); }}
              >
                <Trash2 size={13} /> Delete session
              </button>
            </div>
          )}
        </span>
      </div>
      {confirming && (
        <div className={styles.confirmRow}>
          <span className={styles.confirmLabel}>Remove this session?</span>
          <button
            type="button"
            className={`${btn.button} ${btn.buttonDanger} ${btn.buttonSmall}`}
            onClick={() => { setConfirming(false); onDelete(plan); }}
          >
            <Trash2 size={13} /> Confirm
          </button>
          <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
      {candidates && (
        <div className={styles.linkPicker}>
          <span className={styles.linkPickerLabel}>Link which session?</span>
          <div className={styles.linkOptions}>
            {candidates.map(w => (
              <button
                key={w.id}
                type="button"
                className={`${btn.button} ${btn.buttonSmall}`}
                onClick={() => linkWorkout(w.id)}
              >
                {formatDistance(w.distance)}{w.pace_ms ? ` @ ${formatPace(w.pace_ms)}` : ''}
              </button>
            ))}
            <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={() => setCandidates(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
