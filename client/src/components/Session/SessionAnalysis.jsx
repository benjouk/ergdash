import { Sparkles } from 'lucide-react';
import ChartInfo from '../Charts/ChartInfo.jsx';
import { execLabel, showsExecution } from '../../utils/executionLabels.js';
import styles from './SessionAnalysis.module.css';

const READ_ORDER = ['intensity', 'pacing', 'rate', 'hr_drift'];

// A concise interpretation layer above the measured session data. `cardStyles`
// supplies the shared Session card/header chrome.
export default function SessionAnalysis({
  analysis,
  insight = [],
  narrative = null,
  cardStyles,
}) {
  const reads = analysis?.execution
    ? READ_ORDER
      .map(kind => ({
        kind,
        metric: analysis.execution[kind],
        parts: readLabelParts(kind, analysis.execution[kind]),
      }))
      .filter(({ metric, parts }) => showsExecution(metric) && parts)
    : [];
  const hasReads = reads.length > 0;
  const hasNarrative = narrative != null && typeof narrative === 'object';
  const insights = !hasNarrative && Array.isArray(insight) ? insight : [];
  const qualityNotice = dataQualityNotice(analysis);

  if (!hasReads && insights.length === 0 && !hasNarrative) return null;

  const hasCoachingContent = hasNarrative && (
    narrative.headline
    || narrative.summary
    || narrative.recommendation
    || hasReads
  );

  const readsBlock = hasReads && (
    <ul className={styles.reads} aria-label="Session reads">
      {reads.map(({ kind, parts }) => (
        <li key={kind} className={styles.read}>
          {parts.label && <span className={styles.readLabel}>{parts.label}</span>}
          <span className={styles.readValue}>{parts.value}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={cardStyles.card}>
      <div className={`${cardStyles.cardHeader} ${styles.cardHeader}`}>
        <div className={cardStyles.cardTitle}>
          <Sparkles size={13} className={styles.titleIcon} aria-hidden="true" />
          Session analysis
        </div>
        <ChartInfo>Automated coaching summary from pace, power, rate and heart rate. It is an interpretation, not a measured fact.</ChartInfo>
      </div>

      {hasCoachingContent && (
        <section className={styles.narrative} aria-label="Coaching summary">
          {narrative.headline && (
            <div className={styles.narrativeHeading}>
              <h2 className={styles.headline}>{narrative.headline}</h2>
            </div>
          )}
          {narrative.summary && <p className={styles.summary}>{narrative.summary}</p>}
          {readsBlock}
          {narrative.recommendation && (
            <p className={styles.recommendation}>
              <span className={styles.nextTimeLabel}>Next time:</span>
              {narrative.recommendation}
            </p>
          )}
          {qualityNotice && <p className={styles.qualityNotice}>{qualityNotice}</p>}
        </section>
      )}

      {!hasCoachingContent && qualityNotice && (
        <p className={`${styles.qualityNotice} ${styles.qualityNoticeStandalone}`}>{qualityNotice}</p>
      )}

      {insights.length > 0 && (
        <div className={styles.takeaways}>
          {insights.map(item => (
            <p key={item.id} className={`${styles.takeaway} ${styles[`tone_${item.kind}`] || ''}`}>
              {item.text}
            </p>
          ))}
        </div>
      )}

      {!hasNarrative && readsBlock && (
        <div className={styles.legacyReads}>{readsBlock}</div>
      )}
    </div>
  );
}

// One quiet line about how trustworthy the reads are. A located scored piece
// is reassurance (the reads deliberately ignore the padding); an unresolved
// mismatch is a caution.
export function dataQualityNotice(analysis) {
  const window = analysis?.analysis_window;
  if (window) {
    const stream = Number(window.stream_distance_m);
    const start = Number(window.start_distance_m);
    const end = Number(window.end_distance_m);
    const windowNotice = Number.isFinite(stream) && Number.isFinite(start) && Number.isFinite(end)
      ? `The recording spans ${stream.toLocaleString()}m around the scored piece; the analysis reads the ${(end - start).toLocaleString()}m stretch that matches the summary.`
      : 'The recording extends beyond the scored piece; the analysis reads the stretch that matches the summary.';
    if (analysis?.data_quality?.scored_piece?.reconciled === false) {
      return `${windowNotice} The scored-piece summary and stroke data do not fully reconcile, so treat these reads with some caution.`;
    }
    return windowNotice;
  }
  const quality = analysis?.data_quality;
  if (quality && quality.reconciled === false) {
    return 'The session summary and stroke data do not fully reconcile, so treat these reads with some caution.';
  }
  return null;
}

// A single read split into its label ("Effort") and value ("likely hard") so
// the UI can present them as distinct pills instead of one ·-joined line, where
// the read separators and the within-value separators were indistinguishable.
export function readLabelParts(kind, metric) {
  if (!metric) return null;

  if (kind === 'intensity') {
    const effort = execLabel(kind, metric);
    return effort ? { label: 'Effort', value: lowerFirst(effort) } : null;
  }

  const base = execLabel(kind, kind === 'pacing' ? metric : { value: metric.value });
  if (!base) return null;
  if (kind === 'pacing') {
    const pacing = base.startsWith('Even ·') ? base.replace('Even', 'Even overall') : base;
    return { label: 'Pacing', value: lowerFirst(pacing) };
  }
  if (kind === 'rate') {
    const rate = metric.value === 'stable_avg_variable_stroke' ? 'Variable stroke-to-stroke' : base;
    return { label: 'Rate', value: lowerFirst(rate) };
  }
  if (kind === 'hr_drift') {
    const drift = metric.drift_percent == null ? NaN : Number(metric.drift_percent);
    const value = Number.isFinite(drift)
      ? `${lowerFirst(base)} (${drift > 0 ? '+' : ''}${drift.toFixed(1)}%)`
      : lowerFirst(base);
    return { label: 'HR drift', value };
  }
  return { label: null, value: base };
}

// Retained for callers and tests that want the flat "Label: value" string.
export function compactReadLabel(kind, metric) {
  const parts = readLabelParts(kind, metric);
  if (!parts) return null;
  return parts.label ? `${parts.label}: ${parts.value}` : parts.value;
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
