import { useEffect, useId, useState } from 'react';
import { execLabel, showsExecution } from '../../utils/executionLabels.js';
import styles from './ExecutionChips.module.css';

// Chip labels for each execution channel.
const CHIP_LABELS = {
  intensity: 'Observed effort',
  pacing: 'Pacing',
  finish: 'Finish',
  rate: 'Rate',
  stroke_effectiveness: 'Work/stroke',
};

const CHIP_ORDER = ['intensity', 'pacing', 'finish', 'rate', 'stroke_effectiveness'];

// The observed-execution labels, shown as a tier inside the summary block. Only
// the channels confident enough to state appear; tapping a chip reveals its
// `basis` (why that label was chosen) as a full-width disclosure line below the
// row — a mobile-safe alternative to a floating tooltip. Renders nothing when no
// channel qualifies, so the summary block shows no empty tier.
export default function ExecutionChips({ analysis }) {
  const [openKind, setOpenKind] = useState(null);
  const explainId = useId();

  // Close the open explanation on Escape.
  useEffect(() => {
    if (!openKind) return undefined;
    const onKeyDown = e => { if (e.key === 'Escape') setOpenKind(null); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openKind]);

  if (!analysis?.execution) return null;

  const chips = CHIP_ORDER
    .map(kind => ({ kind, metric: analysis.execution[kind] }))
    .filter(({ kind, metric }) => showsExecution(metric) && execLabel(kind, metric.value));

  if (chips.length === 0) return null;

  const openChip = chips.find(c => c.kind === openKind && c.metric.basis);

  return (
    <div className={styles.chipTier}>
      <div className={styles.chips} aria-label="Observed execution">
        {chips.map(({ kind, metric }) => {
          const open = openKind === kind;
          return (
            <button
              type="button"
              key={kind}
              className={`${styles.chip} ${open ? styles.chipOpen : ''}`}
              aria-expanded={open}
              aria-controls={metric.basis ? explainId : undefined}
              onClick={() => setOpenKind(k => (k === kind ? null : kind))}
            >
              <span className={styles.chipLabel}>{CHIP_LABELS[kind]}</span>
              <span className={styles.chipValue}>{execLabel(kind, metric.value)}</span>
              {metric.basis && <span className={styles.chipHint} aria-hidden="true">?</span>}
            </button>
          );
        })}
      </div>
      {openChip && (
        <p id={explainId} role="note" aria-live="polite" className={styles.explain}>
          {openChip.metric.basis}
        </p>
      )}
    </div>
  );
}
