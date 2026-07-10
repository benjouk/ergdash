import { useMemo } from 'react';
import { weekOf } from '../../utils/planCalendar.js';
import {
  planSummary, PLAN_TYPE_LABELS, dominantAdherence, weekTotals,
} from './planFormat.js';
import { AdherenceMarker } from './AdherenceChip.jsx';
import styles from './WeekList.module.css';

const WEEKDAY = { weekday: 'short', timeZone: 'UTC' };

// Agenda list for the week containing the selected day: one tappable row per
// day with its sessions and a single status marker, plus weekly totals.
// Derives everything from data already loaded for the month grid.
export default function WeekList({
  selectedDate, weekStart, plansByDay, metersByDay, today, onSelectDate, formatDistance,
}) {
  const days = useMemo(() => weekOf(selectedDate, weekStart), [selectedDate, weekStart]);
  const totals = useMemo(
    () => weekTotals(days, plansByDay, metersByDay),
    [days, plansByDay, metersByDay],
  );

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>This week</span>
        <div className={styles.totals}>
          <span><strong>{totals.sessionsDone} of {totals.sessionsTotal}</strong> completed</span>
          {totals.plannedMeters > 0 ? (
            <span><strong>{formatDistance(totals.rowedMeters)}</strong> of {formatDistance(totals.plannedMeters)} planned</span>
          ) : totals.rowedMeters > 0 && (
            <span><strong>{formatDistance(totals.rowedMeters)}</strong> rowed</span>
          )}
        </div>
      </div>
      <div className={styles.list}>
        {days.map(day => {
          const plans = plansByDay.get(day) || [];
          const entry = metersByDay.map.get(day);
          const status = dominantAdherence(plans);
          const summary = plans
            .map(p => `${PLAN_TYPE_LABELS[p.type] || p.type} ${planSummary(p, formatDistance)}`)
            .join(' · ');
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDate(day)}
              className={[
                styles.row,
                day === today ? styles.rowToday : '',
                day === selectedDate ? styles.rowSelected : '',
              ].join(' ')}
              aria-label={`${day}${summary ? `, ${summary}` : ', rest day'}${status ? `, ${status}` : ''}`}
            >
              <span className={styles.day}>
                <span className={styles.dayName}>
                  {new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', WEEKDAY)}
                </span>
                <span className={styles.dayNum}>{Number(day.slice(8, 10))}</span>
              </span>
              {plans.length > 0 ? (
                <span className={styles.summary}>{summary}</span>
              ) : (
                <span className={styles.rest}>
                  {entry ? `Rest · ${formatDistance(entry.meters)} rowed` : 'Rest'}
                </span>
              )}
              {status && (
                <span className={styles.status}>
                  <AdherenceMarker adherence={status} />
                  {status}
                  {plans.length > 1 && <span className={styles.count}>×{plans.length}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
