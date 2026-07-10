import { ChevronLeft, ChevronRight } from 'lucide-react';
import { weekdayLabels } from '../../utils/planCalendar.js';
import { dominantAdherence } from './planFormat.js';
import { AdherenceMarker } from './AdherenceChip.jsx';
import styles from './MonthCalendar.module.css';

// Summarise a day's plans for the cell aria-label, e.g. ", 1 completed, 1 missed".
function statusText(cellPlans) {
  if (!cellPlans.length) return '';
  const counts = new Map();
  for (const p of cellPlans) counts.set(p.adherence, (counts.get(p.adherence) || 0) + 1);
  return ', ' + [...counts].map(([state, n]) => `${n} ${state}`).join(', ');
}

// Month grid with its own prev/next nav, a rowed-meters heatmap fill, and one
// status marker per day (shape + colour, so no legend is needed).
export default function MonthCalendar({
  grid, monthTitle, onShiftMonth, plansByDay, metersByDay, selectedDate, today,
  onSelectDate, formatDistance, weekStart,
}) {
  return (
    <div className={styles.calendarCard}>
      <div className={styles.calHeader}>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Previous month"
          onClick={() => onShiftMonth(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className={styles.calTitle}>{monthTitle}</span>
        <button
          type="button"
          className={styles.navButton}
          aria-label="Next month"
          onClick={() => onShiftMonth(1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
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
            const intensity = entry ? 0.10 + 0.30 * (entry.meters / metersByDay.max) : 0;
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
                aria-label={`${cell.date}${entry ? `, ${entry.meters.toLocaleString()}m rowed` : ''}${statusText(cellPlans)}`}
              >
                {intensity > 0 && (
                  <span className={styles.dayFill} style={{ opacity: intensity }} aria-hidden="true" />
                )}
                <span className={styles.dayNumber}>{Number(cell.date.slice(8, 10))}</span>
                {entry && (
                  <span className={styles.dayMeters}>{formatDistance(entry.meters)}</span>
                )}
                {cellPlans.length > 0 && (
                  <span className={styles.dayStatus}>
                    <AdherenceMarker adherence={dominantAdherence(cellPlans)} />
                    {cellPlans.length > 1 && (
                      <span className={styles.dayCount}>×{cellPlans.length}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
