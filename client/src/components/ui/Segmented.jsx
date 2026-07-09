import styles from './Segmented.module.css';

// Pill toggle: options are [value, label] pairs. Shared between Settings and
// the Plan view.
export default function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className={styles.segmented} role="group" aria-label={ariaLabel}>
      {options.map(([val, label]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          aria-pressed={value === val}
          className={`${styles.segment} ${value === val ? styles.segmentActive : ''}`}
        >{label}</button>
      ))}
    </div>
  );
}
