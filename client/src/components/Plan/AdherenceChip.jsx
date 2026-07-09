import styles from './chips.module.css';

// A pill coloured by a plan's adherence state (planned/completed/missed/
// skipped). `dense` collapses it to a dot on narrow screens.
export default function AdherenceChip({ adherence, dense = false, children }) {
  return (
    <span
      className={[
        styles.chip,
        styles[`chip_${adherence}`] || '',
        dense ? styles.chipDense : '',
      ].join(' ')}
    >
      <span className={styles.chipText}>{children}</span>
    </span>
  );
}
