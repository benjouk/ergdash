import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { useUnits } from '../context/UnitsContext.jsx';
import { distanceLabel } from '../components/PBBadge.jsx';
import { ChartSkeleton } from '../components/Skeleton/Skeleton.jsx';
import { useChartData } from '../components/Charts/useChartData.js';
import { selectPrimaryTarget } from './progressModel.js';
import Eyebrow from '../components/Eyebrow/Eyebrow.jsx';
import styles from './Progress.module.css';

const SIGNAL_META = {
  volume: { label: 'Weekly volume', detail: 'Last 7 days' },
  fitness: { label: 'Fitness', detail: '7-day change' },
  form: { label: 'Form', detail: 'Current readiness' },
  pace: { label: 'Steady pace', detail: '30d vs prior 30d' },
};

export default function ProgressOverview() {
  const insight = useChartData(() => api.getWeeklyInsight(), []);
  const goals = useChartData(() => api.getGoals().then(data => data.goals || []), []);

  if (insight.loading) {
    return <div className={styles.overviewLoading}><ChartSkeleton /></div>;
  }

  const overview = insight.data;
  const target = selectPrimaryTarget(goals.data || []);

  return (
    <div className={styles.overview}>
      <section className={`${styles.verdictCard} ${overview?.status ? styles[`verdict_${overview.status.tone}`] : ''}`}>
        <div className={styles.verdictIntro}>
          <Eyebrow>Current direction · last 7 days</Eyebrow>
          {overview?.status ? (
            <>
              <div className={styles.verdictHeading}>
                <h3>{overview.status.label}</h3>
              </div>
              <p>{overview.status.summary}</p>
            </>
          ) : (
            <>
              <h3>Training status unavailable</h3>
              <p>We could not calculate the current direction. Your detailed charts are still available.</p>
            </>
          )}
        </div>

        {overview?.insights?.length > 0 && (
          <ul className={styles.insightList}>
            {overview.insights.slice(0, 4).map(item => (
              <li key={item.id} className={styles[`insight_${item.kind}`] || ''}>
                <span aria-hidden="true" />
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="signals-heading">
        <div className={styles.sectionHeading}>
          <div>
            <Eyebrow>The evidence</Eyebrow>
            <h3 id="signals-heading">Four signals worth watching</h3>
          </div>
          <span>Fixed windows are labelled so the numbers stay comparable.</span>
        </div>
        <div className={styles.signalGrid}>
          {Object.keys(SIGNAL_META).map(key => (
            <SignalCard key={key} signalKey={key} signal={overview?.signals?.[key]} />
          ))}
        </div>
      </section>

      <hr className={styles.sectionDivider} aria-hidden="true" />

      <PrimaryTarget target={target} loading={goals.loading} />
    </div>
  );
}

function SignalCard({ signalKey, signal }) {
  const { formatPace } = useUnits();
  const meta = SIGNAL_META[signalKey];
  const formatted = formatSignal(signalKey, signal, formatPace);

  return (
    <Link to="/progress?view=training" className={styles.signalCard} aria-label={`${meta.label}: ${formatted.value}. View training detail`}>
      <span className={styles.signalLabel}>{meta.label}</span>
      <strong className={styles.signalValue}>{formatted.value}</strong>
      <span className={`${styles.signalDelta} ${styles[`signal_${formatted.tone}`] || ''}`}>
        {formatted.delta}
      </span>
      <span className={styles.signalFoot}>{meta.detail}<ArrowRight size={13} aria-hidden="true" /></span>
    </Link>
  );
}

export function formatSignal(key, signal, formatPace) {
  if (!signal) return { value: '—', delta: 'Unavailable', tone: 'neutral' };

  if (key === 'volume') {
    const value = `${Number(signal.value_meters || 0).toLocaleString()}m`;
    if (signal.delta_pct == null) return { value, delta: `${signal.sessions || 0} sessions · no prior week`, tone: 'neutral' };
    const pct = Math.round(Math.abs(signal.delta_pct) * 100);
    return { value, delta: `${signal.delta_pct >= 0 ? 'Up' : 'Down'} ${pct}% vs prior week`, tone: signal.delta_pct >= 0 ? 'positive' : 'watch' };
  }

  if (key === 'fitness') {
    const value = signal.value == null ? '—' : Number(signal.value).toFixed(1);
    if (signal.delta_7d == null) return { value, delta: 'No 7-day comparison', tone: 'neutral' };
    const delta = Number(signal.delta_7d);
    return { value, delta: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} over 7 days`, tone: delta > 0 ? 'positive' : delta < 0 ? 'watch' : 'neutral' };
  }

  if (key === 'form') {
    const value = signal.value == null ? '—' : `${signal.value > 0 ? '+' : ''}${Number(signal.value).toFixed(1)}`;
    const labels = { fresh: 'Fresh · good test window', fatigued: 'Fatigued · keep it easy', balanced: 'Balanced · train normally' };
    return { value, delta: labels[signal.readiness] || 'Not enough fitness data', tone: signal.readiness === 'fresh' ? 'positive' : signal.readiness === 'fatigued' ? 'watch' : 'neutral' };
  }

  const value = signal.value_ms == null ? '—' : formatPace(signal.value_ms);
  if (signal.delta_ms == null) return { value, delta: 'No prior 30-day comparison', tone: 'neutral' };
  const seconds = Math.abs(signal.delta_ms) / 1000;
  return { value, delta: `${seconds.toFixed(1)}s ${signal.delta_ms <= 0 ? 'faster' : 'slower'}`, tone: signal.delta_ms <= 0 ? 'positive' : 'watch' };
}

function PrimaryTarget({ target, loading }) {
  const { formatTime, formatPace } = useUnits();

  if (loading) return <ChartSkeleton />;

  if (!target) {
    return (
      <section className={styles.targetEmpty}>
        <div>
          <Eyebrow>Primary target</Eyebrow>
          <h3>Give the trend somewhere to go</h3>
          <p>Set a performance target to compare your PB and current projection against a real outcome.</p>
        </div>
        <Link to="/settings" className={styles.primaryAction}>Set a target <ArrowRight size={15} aria-hidden="true" /></Link>
      </section>
    );
  }

  const progress = target.progress || {};
  const predicted = progress.prediction?.predicted_time;
  const days = progress.days_to_race;

  return (
    <section className={styles.targetCard}>
      <div className={styles.targetLead}>
        <Eyebrow>Primary target · current projection</Eyebrow>
        <div className={styles.targetTitleRow}>
          <h3>{distanceLabel(target.distance)} · {formatTime(target.target_time_ms)}</h3>
          {days != null && days >= 0 && <span>{days === 0 ? 'Race today' : `${days} days to race`}</span>}
        </div>
        <p>{target.label || `${distanceLabel(target.distance)} performance target`} · {formatPace(progress.target_pace_ms)} /500m</p>
      </div>
      <div className={styles.targetMetrics}>
        <TargetMetric label="Current PB" value={progress.pb ? formatTime(progress.pb.time_ms) : '—'} sub={gapText(progress.pb_delta_ms, 'from goal')} />
        <TargetMetric label="Projection" value={predicted ? formatTime(predicted) : '—'} sub={predicted ? gapText(progress.prediction_delta_ms, 'from goal') : 'Not enough hard results'} />
      </div>
      <Link to="/progress?view=performance" className={styles.secondaryAction}>Open performance detail <ArrowRight size={14} aria-hidden="true" /></Link>
    </section>
  );
}

function TargetMetric({ label, value, sub }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

function gapText(deltaMs, suffix) {
  if (deltaMs == null) return 'No comparison yet';
  if (deltaMs <= 0) return `${(Math.abs(deltaMs) / 1000).toFixed(1)}s inside goal`;
  return `${(deltaMs / 1000).toFixed(1)}s ${suffix}`;
}
