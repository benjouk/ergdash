import { weekdayLabels } from '../../utils/planCalendar.js';
import { planSummary } from './planFormat.js';
import AdherenceChip from './AdherenceChip.jsx';
import styles from './MonthCalendar.module.css';

const LEGEND = ['planned', 'completed', 'missed', 'skipped'];

// Month grid with a rowed-meters heatmap fill and per-day adherence chips.
export default function MonthCalendar({
  grid, plansByDay, metersByDay, selectedDate, today, onSelectDate, formatDistance, weekStart,
}) {
  return (
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
                onClick={() => onSelectDate(cell.date)}
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
                    <AdherenceChip key={p.id} adherence={p.adherence} dense>
                      {p.type} {planSummary(p, formatDistance)}
                    </AdherenceChip>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <div className={styles.legend}>
        {LEGEND.map(state => (
          <AdherenceChip key={state} adherence={state}>{state}</AdherenceChip>
        ))}
      </div>
    </div>
  );
}
