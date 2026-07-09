import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import PlanRow from './PlanRow.jsx';
import SessionForm from './SessionForm.jsx';
import btn from '../ui/Button.module.css';
import styles from './DayPanel.module.css';

function longDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

// Detail card for the selected day: rowed summary, planned sessions, and the
// add/edit form. Owns its own edit state.
export default function DayPanel({
  date, plans, dayActual, linkedWorkoutIds, programsById, onChanged, formatDistance, formatPace,
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(null); // { mode: 'new'|'edit', plan? } | null

  // Close the form when the user navigates to a different day.
  useEffect(() => { setEditing(null); }, [date]);

  const closeAnd = (fn) => { setEditing(null); if (fn) fn(); };

  const remove = (plan) => {
    api.deletePlan(plan.id)
      .then(() => { toast.success('Plan removed'); closeAnd(onChanged); })
      .catch(err => toast.error(err.message || 'Could not remove plan'));
  };

  return (
    <div className={styles.dayPanel}>
      <div className={styles.header}>
        <h3 className={styles.title}>{longDate(date)}</h3>
        {!editing && (
          <button
            type="button"
            className={`${btn.button} ${btn.buttonSmall}`}
            onClick={() => setEditing({ mode: 'new' })}
          >
            <Plus size={14} /> Add session
          </button>
        )}
      </div>

      {dayActual && (
        <div className={styles.actual}>
          Rowed {dayActual.meters.toLocaleString()}m in {dayActual.sessions} session{dayActual.sessions === 1 ? '' : 's'}
        </div>
      )}

      {plans.length === 0 && !editing && (
        <div className={styles.empty}>Nothing planned. Add a session to build your week.</div>
      )}

      <div className={styles.list}>
        {plans.map(plan => (
          <PlanRow
            key={plan.id}
            plan={plan}
            dayActual={dayActual}
            linkedWorkoutIds={linkedWorkoutIds}
            program={plan.program_id ? programsById.get(plan.program_id) : null}
            onEdit={p => setEditing({ mode: 'edit', plan: p })}
            onDelete={remove}
            onChanged={onChanged}
            formatDistance={formatDistance}
            formatPace={formatPace}
          />
        ))}
      </div>

      {editing && (
        <SessionForm
          plan={editing.mode === 'edit' ? editing.plan : null}
          date={date}
          onSaved={() => closeAnd(onChanged)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
