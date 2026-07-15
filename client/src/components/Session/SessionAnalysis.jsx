import { useEffect, useId, useState } from 'react';
import { Sparkles } from 'lucide-react';
import ChartInfo from '../Charts/ChartInfo.jsx';
import { execLabel, showsExecution } from '../../utils/executionLabels.js';
import styles from './SessionAnalysis.module.css';

// Labels for each execution channel.
const READ_LABELS = {
  intensity: 'Observed effort',
  pacing: 'Pacing',
  finish: 'Finish',
  rate: 'Rate',
  stroke_effectiveness: 'Work per stroke',
  hr_drift: 'HR drift',
};

const READ_ORDER = ['intensity', 'pacing', 'finish', 'rate', 'stroke_effectiveness', 'hr_drift'];

// Derived "what we think it means" for a session, styled like the Details card:
// a compact two-column grid of label → value rows. The natural-language insight
// leads; tapping a row reveals that read's reasoning as a single line at the
// foot of the card (mobile-safe, no floating popover). `cardStyles` is the
// Session CSS module (card/header chrome).
export default function SessionAnalysis({ analysis, insight = [], cardStyles }) {
  const [openKind, setOpenKind] = useState(null);
  const explainId = useId();

  // Close the open explanation on Escape.
  useEffect(() => {
    if (!openKind) return undefined;
    const onKeyDown = e => { if (e.key === 'Escape') setOpenKind(null); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openKind]);

  const reads = analysis?.execution
    ? READ_ORDER
      .map(kind => ({ kind, metric: analysis.execution[kind] }))
      .filter(({ kind, metric }) => showsExecution(metric) && execLabel(kind, metric.value))
    : [];
  const insights = Array.isArray(insight) ? insight : [];

  if (reads.length === 0 && insights.length === 0) return null;

  const openRead = reads.find(r => r.kind === openKind && r.metric.basis);

  return (
    <div className={cardStyles.card}>
      <div className={cardStyles.cardHeader}>
        <div className={cardStyles.cardTitle}>
          <Sparkles size={13} className={styles.titleIcon} aria-hidden="true" />
          Session analysis
        </div>
        <ChartInfo>Automated reads of this session from pace, power, rate and heart rate — interpretations, not measured facts. Tap a row to see the reasoning.</ChartInfo>
      </div>

      {insights.length > 0 && (
        <div className={styles.takeaways}>
          {insights.map(item => (
            <p key={item.id} className={`${styles.takeaway} ${styles[`tone_${item.kind}`] || ''}`}>
              {item.text}
            </p>
          ))}
        </div>
      )}

      <div className={styles.reads}>
        {reads.map(({ kind, metric }) => {
          const open = openKind === kind;
          return (
            <button
              type="button"
              key={kind}
              className={`${styles.read} ${open ? styles.readOpen : ''}`}
              aria-expanded={open}
              aria-controls={metric.basis ? explainId : undefined}
              onClick={() => setOpenKind(k => (k === kind ? null : kind))}
            >
              <span className={styles.readLabel}>{READ_LABELS[kind]}</span>
              <span className={styles.readValue}>{execLabel(kind, metric.value)}</span>
            </button>
          );
        })}
      </div>

      {openRead && (
        <p id={explainId} role="note" aria-live="polite" className={styles.explain}>
          <span className={styles.explainLabel}>{READ_LABELS[openRead.kind]}</span>
          {openRead.metric.basis}
        </p>
      )}
    </div>
  );
}
