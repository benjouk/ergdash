import { Sparkles } from 'lucide-react';
import ChartInfo from '../Charts/ChartInfo.jsx';
import { execLabel, showsExecution } from '../../utils/executionLabels.js';
import styles from './SessionAnalysis.module.css';

const READ_ORDER = ['intensity', 'pacing', 'rate', 'hr_drift'];

const INTENT_OPTIONS = [
  { value: 'steady', label: 'Steady' },
  { value: 'hard_distance', label: 'Hard distance' },
  { value: 'test_race', label: 'Test / race' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'technique', label: 'Technique' },
];

// A concise interpretation layer above the measured session data. `cardStyles`
// supplies the shared Session card/header chrome.
export default function SessionAnalysis({
  analysis,
  insight = [],
  narrative = null,
  onIntentChange,
  intentSaving = null,
  cardStyles,
}) {
  const reads = analysis?.execution
    ? READ_ORDER
      .map(kind => ({
        kind,
        metric: analysis.execution[kind],
        label: compactReadLabel(kind, analysis.execution[kind]),
      }))
      .filter(({ metric, label }) => showsExecution(metric) && label)
    : [];
  const readLine = reads.map(read => read.label).join(' · ');
  const hasNarrative = narrative != null && typeof narrative === 'object';
  const insights = !hasNarrative && Array.isArray(insight) ? insight : [];
  const needsIntent = Boolean(hasNarrative && narrative.needs_intent && onIntentChange);
  const intentLabel = INTENT_OPTIONS.find(option => option.value === narrative?.intent)?.label;

  if (reads.length === 0 && insights.length === 0 && !hasNarrative) return null;

  const hasCoachingContent = hasNarrative && (
    narrative.headline
    || narrative.summary
    || narrative.recommendation
    || readLine
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
          {(narrative.headline || intentLabel) && (
            <div className={styles.narrativeHeading}>
              {narrative.headline && <h2 className={styles.headline}>{narrative.headline}</h2>}
              {intentLabel && (
                <span className={styles.purposeTag} aria-label={`Purpose: ${intentLabel}`}>
                  {intentLabel}
                </span>
              )}
            </div>
          )}
          {narrative.summary && <p className={styles.summary}>{firstSentence(narrative.summary)}</p>}
          {readLine && <p className={styles.readLine}>{readLine}</p>}
          {narrative.recommendation && (
            <p className={styles.recommendation}>
              <span className={styles.nextTimeLabel}>Next time:</span>
              {narrative.recommendation}
            </p>
          )}
        </section>
      )}

      {needsIntent && (
        <section className={styles.intentPrompt} aria-label="Set session purpose">
          <p>What was the purpose of this row?</p>
          <div className={styles.intentChips} role="group" aria-label="Session purpose">
            {INTENT_OPTIONS.map(option => (
              <button
                type="button"
                key={option.value}
                className={styles.intentChip}
                disabled={Boolean(intentSaving)}
                aria-pressed={narrative.intent === option.value}
                onClick={() => onIntentChange(option.value)}
              >
                {intentSaving === option.value ? 'Saving…' : option.label}
              </button>
            ))}
          </div>
        </section>
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

      {!hasNarrative && readLine && <p className={styles.legacyReadLine}>{readLine}</p>}
    </div>
  );
}

export function firstSentence(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
}

export function compactReadLabel(kind, metric) {
  if (!metric) return null;

  if (kind === 'intensity') {
    const effort = execLabel(kind, metric);
    return effort ? `Effort: ${lowerFirst(effort)}` : null;
  }

  const base = execLabel(kind, { value: metric.value });
  if (!base) return null;
  if (kind === 'pacing') return `Pacing: ${lowerFirst(base)}`;
  if (kind === 'rate') {
    const rate = metric.value === 'stable_avg_variable_stroke' ? 'Variable' : base;
    return `Rate: ${lowerFirst(rate)}`;
  }
  if (kind === 'hr_drift') return `HR drift: ${lowerFirst(base)}`;
  return base;
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
