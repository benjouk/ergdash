import { useEffect, useId, useState } from 'react';
import { Sparkles } from 'lucide-react';
import ChartInfo from '../Charts/ChartInfo.jsx';
import { execLabel, showsExecution } from '../../utils/executionLabels.js';
import styles from './SessionAnalysis.module.css';

// Labels for each execution channel.
const CHIP_LABELS = {
  intensity: 'Observed effort',
  pacing: 'Pacing',
  finish: 'Finish',
  rate: 'Rate',
  stroke_effectiveness: 'Work/stroke',
};

const CHIP_ORDER = ['intensity', 'pacing', 'finish', 'rate', 'stroke_effectiveness'];

// Derived "what we think it means" for a session, kept visually distinct from the
// measured summary card so the system's opinions don't read as facts. Holds the
// execution labels (tap any to reveal why it was chosen) and the natural-language
// insights, with a single block-level "how is this calculated?" affordance.
export default function SessionAnalysis({ analysis, insight = [] }) {
  const [openKind, setOpenKind] = useState(null);
  const explainId = useId();

  // Close the open explanation on Escape.
  useEffect(() => {
    if (!openKind) return undefined;
    const onKeyDown = e => { if (e.key === 'Escape') setOpenKind(null); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openKind]);

  const chips = analysis?.execution
    ? CHIP_ORDER
      .map(kind => ({ kind, metric: analysis.execution[kind] }))
      .filter(({ kind, metric }) => showsExecution(metric) && execLabel(kind, metric.value))
    : [];
  const insights = Array.isArray(insight) ? insight : [];

  if (chips.length === 0 && insights.length === 0) return null;

  const openChip = chips.find(c => c.kind === openKind && c.metric.basis);

  return (
    <section className={styles.block} aria-label="Session analysis">
      <div className={styles.header}>
        <Sparkles size={14} className={styles.headerIcon} aria-hidden="true" />
        <span className={styles.label}>Session analysis</span>
      </div>

      {chips.length > 0 && (
        <div className={styles.chips}>
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
              </button>
            );
          })}
        </div>
      )}

      {openChip && (
        <p id={explainId} role="note" aria-live="polite" className={styles.explain}>
          {openChip.metric.basis}
        </p>
      )}

      {insights.length > 0 && (
        <ul className={styles.insights}>
          {insights.map(item => (
            <li key={item.id} className={`${styles.insightItem} ${styles[`tone_${item.kind}`] || ''}`}>
              {item.text}
            </li>
          ))}
        </ul>
      )}

      <ChartInfo>These are automated reads of your session from pace, power, rate and heart rate — not measured facts. Tap a label to see the reasoning behind it.</ChartInfo>
    </section>
  );
}
