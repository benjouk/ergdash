import { Circle, CircleAlert, CircleCheck, Minus } from 'lucide-react';
import styles from './chips.module.css';

// A pill coloured by a plan's adherence state (planned/completed/missed/
// skipped).
export default function AdherenceChip({ adherence, children }) {
  return (
    <span
      className={[
        styles.chip,
        styles[`chip_${adherence}`] || '',
      ].join(' ')}
    >
      <span className={styles.chipText}>{children}</span>
    </span>
  );
}

const MARKER_ICONS = {
  planned: Circle,
  completed: CircleCheck,
  missed: CircleAlert,
  skipped: Minus,
};

// Compact icon marker for the same states: shape + colour, so status stays
// readable without a legend (and for colour-blind users).
export function AdherenceMarker({ adherence, size = 12 }) {
  const Icon = MARKER_ICONS[adherence];
  if (!Icon) return null;
  return (
    <span
      className={[styles.marker, styles[`marker_${adherence}`] || ''].join(' ')}
      aria-hidden="true"
    >
      <Icon size={size} />
    </span>
  );
}
