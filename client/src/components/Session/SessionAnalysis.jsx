import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import ChartInfo from '../Charts/ChartInfo.jsx';
import { execLabel, showsExecution } from '../../utils/executionLabels.js';
import styles from './SessionAnalysis.module.css';

const READ_LABELS = {
  intensity: 'Observed effort',
  pacing: 'Pacing',
  rate: 'Rate',
  hr_drift: 'HR drift',
};

const READ_ORDER = ['intensity', 'pacing', 'rate', 'hr_drift'];

const INTENT_OPTIONS = [
  { value: 'steady', label: 'Steady' },
  { value: 'hard_distance', label: 'Hard distance' },
  { value: 'test_race', label: 'Test / race' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'technique', label: 'Technique' },
];

// Derived "what we think it means" for a session. `cardStyles` is the Session
// CSS module and supplies the shared card/header chrome.
export default function SessionAnalysis({
  analysis,
  insight = [],
  narrative = null,
  plan = null,
  formatPace,
  formatTime,
  onIntentChange,
  intentSaving = null,
  cardStyles,
}) {
  const [openKind, setOpenKind] = useState(null);
  const explainId = useId();

  useEffect(() => {
    if (!openKind) return undefined;
    const onKeyDown = event => { if (event.key === 'Escape') setOpenKind(null); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openKind]);

  const reads = analysis?.execution
    ? READ_ORDER
      .map(kind => ({ kind, metric: analysis.execution[kind] }))
      .filter(({ kind, metric }) => showsExecution(metric) && execLabel(kind, metric))
    : [];
  const hasNarrative = narrative != null && typeof narrative === 'object';
  const insights = !hasNarrative && Array.isArray(insight) ? insight : [];
  const planReview = hasNarrative && narrative.plan_review && typeof narrative.plan_review === 'object'
    ? narrative.plan_review
    : null;
  const dataQuality = analysis?.data_quality;
  const qualityIssues = !dataQuality?.reconciled && Array.isArray(dataQuality?.issues)
    ? dataQuality.issues
    : [];
  const needsIntent = Boolean(hasNarrative && narrative.needs_intent && onIntentChange);

  if (
    reads.length === 0
    && insights.length === 0
    && qualityIssues.length === 0
    && !hasNarrative
  ) return null;

  const openRead = reads.find(read => read.kind === openKind && read.metric.basis);
  const qualityOpen = openKind === 'data_quality' && qualityIssues.length > 0;

  return (
    <div className={cardStyles.card}>
      <div className={cardStyles.cardHeader}>
        <div className={cardStyles.cardTitle}>
          <Sparkles size={13} className={styles.titleIcon} aria-hidden="true" />
          Session analysis
        </div>
        <ChartInfo>Automated reads of this session from pace, power, rate and heart rate. They are interpretations, not measured facts. Tap a read to see the reasoning.</ChartInfo>
      </div>

      {hasNarrative && (narrative.headline || narrative.summary || narrative.recommendation) && (
        <section className={styles.narrative} aria-label="Coaching summary">
          {narrative.headline && <h2 className={styles.headline}>{narrative.headline}</h2>}
          {narrative.summary && <p className={styles.summary}>{narrative.summary}</p>}
          {narrative.recommendation && (
            <p className={styles.recommendation}>
              <span className={styles.sectionLabel}>Recommendation</span>
              {narrative.recommendation}
            </p>
          )}
        </section>
      )}

      {needsIntent && (
        <section className={styles.intentPrompt} aria-labelledby={`${explainId}-intent`}>
          <p id={`${explainId}-intent`}>What was the purpose of this row?</p>
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

      {planReview && (
        <PlanReview
          review={planReview}
          plan={plan}
          formatPace={formatPace}
          formatTime={formatTime}
        />
      )}

      {qualityIssues.length > 0 && (
        <button
          type="button"
          className={`${styles.qualityNotice} ${qualityOpen ? styles.qualityNoticeOpen : ''}`}
          aria-expanded={qualityOpen}
          aria-controls={explainId}
          onClick={() => setOpenKind(kind => (kind === 'data_quality' ? null : 'data_quality'))}
        >
          Summary totals don&apos;t fully reconcile with stroke data
        </button>
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

      {reads.length > 0 && (
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
                onClick={() => setOpenKind(current => (current === kind ? null : kind))}
              >
                <span className={styles.readLabel}>{READ_LABELS[kind]}</span>
                <span className={styles.readValue}>{execLabel(kind, metric)}</span>
              </button>
            );
          })}
        </div>
      )}

      {(qualityOpen || openRead) && (
        <div id={explainId} role="note" aria-live="polite" className={styles.explain}>
          <span className={styles.explainLabel}>
            {qualityOpen ? 'Data quality' : READ_LABELS[openRead.kind]}
          </span>
          {qualityOpen ? (
            <span className={styles.explainIssues}>
              {qualityIssues.map(issue => <span key={issue.field}>{issue.message}</span>)}
            </span>
          ) : (
            <span>
              {openRead.metric.basis}
              {openRead.kind === 'intensity' && openRead.metric.estimated && (
                <>
                  {' '}Based on estimated HR zones. Set your measured max HR in{' '}
                  <Link className={styles.settingsLink} to="/settings">Settings</Link> to improve this.
                </>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PlanReview({ review, plan, formatPace, formatTime }) {
  const planned = review.planned || {};
  const actual = review.actual || {};
  const purpose = planned.notes ?? review.notes ?? plan?.notes;
  const plannedItems = compact([
    metricItem('Pace', paceValue(planned.target_pace_ms ?? planned.pace_ms, formatPace)),
    metricItem('Rate', rateValue(planned.target_rate ?? planned.rate ?? planned.avg_rate)),
    metricItem('Distance', distanceValue(planned.target_distance ?? planned.distance)),
    metricItem('Time', timeValue(planned.target_duration_ms ?? planned.duration_ms ?? planned.time_ms, formatTime)),
  ]);
  const actualItems = compact([
    metricItem('Pace', paceValue(actual.pace_ms, formatPace)),
    metricItem('Rate', rateValue(actual.avg_rate ?? actual.average_rate ?? actual.rate)),
    metricItem('Zone', zoneValue(actual.dominant_zone)),
    metricItem('HR drift', driftValue(actual.hr_drift_pct ?? actual.drift_percent)),
  ]);

  return (
    <section className={styles.planReview} aria-label="Plan review">
      {purpose && (
        <p className={styles.purpose}>
          <span className={styles.sectionLabel}>Purpose</span>
          {purpose}
        </p>
      )}
      <div className={styles.reviewGrid}>
        <ReviewColumn label="Planned" items={plannedItems} />
        <ReviewColumn label="Actual" items={actualItems} />
        <div className={styles.reviewColumn}>
          <span className={styles.reviewHeading}>Assessment</span>
          <p className={styles.assessment}>{review.assessment || 'No target comparison available.'}</p>
        </div>
      </div>
    </section>
  );
}

function ReviewColumn({ label, items }) {
  return (
    <div className={styles.reviewColumn}>
      <span className={styles.reviewHeading}>{label}</span>
      {items.length > 0 ? (
        <dl className={styles.reviewMetrics}>
          {items.map(item => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : <span className={styles.noReviewData}>Not specified</span>}
    </div>
  );
}

function metricItem(label, value) {
  return value == null ? null : { label, value };
}

function compact(values) {
  return values.filter(Boolean);
}

function paceValue(value, formatPace) {
  if (!(Number(value) > 0)) return null;
  return formatPace ? formatPace(Number(value)) : `${Math.round(Number(value))} ms`;
}

function rateValue(value) {
  const rate = Number(value);
  if (!(rate > 0)) return null;
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)} spm`;
}

function distanceValue(value) {
  const distance = Number(value);
  return distance > 0 ? `${Math.round(distance).toLocaleString()}m` : null;
}

function timeValue(value, formatTime) {
  const time = Number(value);
  if (!(time > 0)) return null;
  return formatTime ? formatTime(time) : `${Math.round(time / 1000)}s`;
}

function zoneValue(value) {
  if (value == null || value === '') return null;
  const match = String(value).match(/^z(?:one)?\s*(\d)$/i) || String(value).match(/^(\d)$/);
  return match ? `Zone ${match[1]}` : String(value);
}

function driftValue(value) {
  const drift = value == null ? NaN : Number(value);
  if (!Number.isFinite(drift)) return null;
  return `${drift > 0 ? '+' : ''}${drift.toFixed(1)}%`;
}
