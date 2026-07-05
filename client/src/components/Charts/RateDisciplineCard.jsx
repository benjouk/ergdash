import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import Sparkline from '../Feed/Sparkline.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

// Compact stat card: how tightly stroke rate held its band per session,
// with a sparkline of recent scores.
export default function RateDisciplineCard() {
  const { from, to } = useTimeRange();
  const { data = [], loading, error, retry } = useChartData(() => {
    const params = { metric: 'rate_discipline', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    return api.getTrends(params).then(d => d.rate_discipline_trend || []);
  }, [from, to]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Rate Discipline" message="Couldn't load chart data." error onRetry={retry} />;
  if (data.length < 3) return <ChartEmpty title="Rate Discipline" />;

  const recent = data.slice(-20);
  const latest = recent[recent.length - 1];
  const avg = recent.reduce((s, d) => s + d.rate_discipline, 0) / recent.length;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Rate Discipline
          <ChartInfo>A 0-100 score for how steadily you held stroke rate within each session. Higher scores mean less drifting between ratings.</ChartInfo>
        </div>
        <div className={styles.chartValue}>
          {latest.rate_discipline.toFixed(0)}
          <span className={styles.chartValueUnit}>/100</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <Sparkline
          data={recent.map(d => d.rate_discipline)}
          color="var(--accent-2)"
          width={180}
          height={36}
          strokeWidth={1.6}
        />
        <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
          avg {avg.toFixed(0)} over {recent.length} sessions
        </span>
      </div>
    </div>
  );
}
