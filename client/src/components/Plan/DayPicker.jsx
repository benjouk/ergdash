import styles from './DayPicker.module.css';

// Weekday multi-select (0=Mon..6=Sun), ordered by the user's week start.
// `value` is a sorted array of ints; `max` caps how many can be picked.
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SUNDAY_FIRST = [6, 0, 1, 2, 3, 4, 5];
const MONDAY_FIRST = [0, 1, 2, 3, 4, 5, 6];

export default function DayPicker({ value, onChange, weekStart = 'monday', max, disabled = false }) {
  const order = weekStart === 'sunday' ? SUNDAY_FIRST : MONDAY_FIRST;
  const toggle = (d) => {
    if (value.includes(d)) onChange(value.filter(x => x !== d));
    else if (!max || value.length < max) onChange([...value, d].sort((a, b) => a - b));
  };
  return (
    <div className={styles.picker}>
      {order.map(d => (
        <button
          key={d}
          type="button"
          disabled={disabled}
          aria-pressed={value.includes(d)}
          className={`${styles.day} ${value.includes(d) ? styles.active : ''}`}
          onClick={() => toggle(d)}
        >
          {DAY_LABELS[d]}
        </button>
      ))}
    </div>
  );
}
