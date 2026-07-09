import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { planSummary, PLAN_TYPE_LABELS } from './planFormat.js';
import AdherenceChip from './AdherenceChip.jsx';
import btn from '../ui/Button.module.css';
import styles from './PlanRow.module.css';

// One planned session with its status actions and inline link-picker.
// `program` (optional) tags the row with its training-program week.
export default function PlanRow({
  plan, dayActual, linkedWorkoutIds, program, onEdit, onChanged, formatDistance, formatPace,
}) {
  const toast = useToast();
  const [candidates, setCandidates] = useState(null); // workout list or null

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
        <AdherenceChip adherence={plan.adherence}>{plan.adherence}</AdherenceChip>
        <span className={styles.planRowTitle}>
          {PLAN_TYPE_LABELS[plan.type] || plan.type}
          {' · '}
          {planSummary(plan, formatDistance)}
          {plan.target_pace_ms ? ` @ ${formatPace(plan.target_pace_ms)}` : ''}
          {plan.target_rate ? ` · ${plan.target_rate}spm` : ''}
        </span>
        {program && (
          <span className={styles.programBadge}>
            <CalendarDays size={11} /> {program.name} · Wk {plan.program_week + 1}
          </span>
        )}
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
      </div>
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
