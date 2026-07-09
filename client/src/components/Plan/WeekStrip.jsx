import { useMemo } from 'react';
import { weekOf } from '../../utils/planCalendar.js';
import { planSummary } from './planFormat.js';
import AdherenceChip from './AdherenceChip.jsx';
import styles from './WeekStrip.module.css';

const WEEKDAY = { weekday: 'short', timeZone: 'UTC' };

// Agenda strip for the week containing the selected day: one card per day with
// its planned sessions and rowed meters, plus a weekly totals footer. Derives
// everything from data already loaded for the month grid — no extra fetch.
export default function WeekStrip({
  selectedDate, weekStart, plansByDay, metersByDay, today, onSelectDate, formatDistance,
}) {
  const days = useMemo(() => weekOf(selectedDate, weekStart), [selectedDate, weekStart]);

  const totals = useMemo(() => {
    let plannedMeters = 0;
    let rowedMeters = 0;
    let sessionsTotal = 0;
    let sessionsDone = 0;
    for (const day of days) {
      for (const p of plansByDay.get(day) || []) {
        sessionsTotal += 1;
        if (p.adherence === 'completed') sessionsDone += 1;
        plannedMeters += p.target_distance || 0;
      }
      const entry = metersByDay.map.get(day);
      if (entry) rowedMeters += entry.meters;
    }
    return { plannedMeters, rowedMeters, sessionsTotal, sessionsDone };
  }, [days, plansByDay, metersByDay]);

  return (
    <div className={styles.strip}>
      <div className={styles.stripHeader}>
        <span className={styles.stripTitle}>This week</span>
        <div className={styles.stripTotals}>
          <span><strong>{totals.sessionsDone}/{totals.sessionsTotal}</strong> done</span>
          <span>rowed <strong>{formatDistance(totals.rowedMeters)}</strong></span>
          {totals.plannedMeters > 0 && (
            <span>planned <strong>{formatDistance(totals.plannedMeters)}</strong></span>
          )}
        </div>
      </div>
      <div className={styles.days}>
        {days.map(day => {
          const plans = plansByDay.get(day) || [];
          const entry = metersByDay.map.get(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDate(day)}
              className={[
                styles.day,
                day === today ? styles.dayToday : '',
                day === selectedDate ? styles.daySelected : '',
              ].join(' ')}
              aria-label={`${day}${plans.length ? `, ${plans.length} planned` : ''}${entry ? `, ${entry.meters.toLocaleString()}m rowed` : ''}`}
            >
              <div className={styles.dayHead}>
                <span className={styles.dayName}>
                  {new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', WEEKDAY)}
                </span>
                <span className={styles.dayNum}>{Number(day.slice(8, 10))}</span>
              </div>
              <div className={styles.dayChips}>
                {plans.map(p => (
                  <AdherenceChip key={p.id} adherence={p.adherence}>
                    {p.type} {planSummary(p, formatDistance)}
                  </AdherenceChip>
                ))}
              </div>
              {entry && <span className={styles.dayMeters}>{formatDistance(entry.meters)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
