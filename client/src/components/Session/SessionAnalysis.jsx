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
  stroke_effectiveness: 'Work per stroke',
};

const CHIP_ORDER = ['intensity', 'pacing', 'finish', 'rate', 'stroke_effectiveness'];

// Derived "what we think it means" for a session, as a card matching the app's
// other cards (header + bordered rows) so the system's reads don't masquerade as
// measured facts. The natural-language insight leads; each execution read is a
// row with the label, its value, and — always visible — the reasoning behind it.
// `cardStyles` is the Session CSS module (card/header chrome).
export default function SessionAnalysis({ analysis, insight = [], cardStyles }) {
  const reads = analysis?.execution
    ? CHIP_ORDER
      .map(kind => ({ kind, metric: analysis.execution[kind] }))
      .filter(({ kind, metric }) => showsExecution(metric) && execLabel(kind, metric.value))
    : [];
  const insights = Array.isArray(insight) ? insight : [];

  if (reads.length === 0 && insights.length === 0) return null;

  return (
    <div className={cardStyles.card}>
      <div className={cardStyles.cardHeader}>
        <div className={cardStyles.cardTitle}>
          <Sparkles size={13} className={styles.titleIcon} aria-hidden="true" />
          Session analysis
        </div>
        <ChartInfo>These are automated reads of your session from pace, power, rate and heart rate — interpretations, not measured facts.</ChartInfo>
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

      <dl className={styles.reads}>
        {reads.map(({ kind, metric }) => (
          <div className={styles.read} key={kind}>
            <div className={styles.readTop}>
              <dt className={styles.readLabel}>{CHIP_LABELS[kind]}</dt>
              <dd className={styles.readValue}>{execLabel(kind, metric.value)}</dd>
            </div>
            {metric.basis && <p className={styles.readWhy}>{metric.basis}</p>}
          </div>
        ))}
      </dl>
    </div>
  );
}
