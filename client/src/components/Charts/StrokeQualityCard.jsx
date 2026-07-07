import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import Sparkline from '../Feed/Sparkline.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

const RECENT_SESSIONS = 20;

// Compact stat card pairing the two 0-100 stroke-quality scores: how tightly
// stroke rate held its band, and how steady the pace was stroke to stroke.
export default function StrokeQualityCard() {
  const { from, to } = useTimeRange();
  const { data, loading, error, retry } = useChartData(async () => {
    const params = { period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;

    const [discipline, consistency] = await Promise.all([
      api.getTrends({ ...params, metric: 'rate_discipline' }).then(d => d.rate_discipline_trend || []),
      api.getTrends({ ...params, metric: 'consistency' }).then(d => d.consistency_trend || []),
    ]);

    return {
      discipline: discipline.map(d => d.rate_discipline),
      consistency: consistency.map(d => d.consistency),
    };
  }, [from, to]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Stroke Quality" message="Couldn't load chart data." error onRetry={retry} />;

  const discipline = (data?.discipline || []).slice(-RECENT_SESSIONS);
  const consistency = (data?.consistency || []).slice(-RECENT_SESSIONS);
  if (discipline.length < 3 && consistency.length < 3) {
    return <ChartEmpty title="Stroke Quality" />;
  }

  const rows = [
    { key: 'discipline', label: 'Rate Discipline', values: discipline, color: 'var(--accent-2)' },
    { key: 'consistency', label: 'Consistency', values: consistency, color: 'var(--accent)' },
  ].filter(row => row.values.length >= 3);

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Stroke Quality
        </div>
        <div className={styles.chartValueUnit} style={{ color: 'var(--ink-3)' }}>
          last {Math.max(...rows.map(row => row.values.length))} sessions
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {rows.map(row => {
          const latest = row.values[row.values.length - 1];
          const avg = row.values.reduce((sum, value) => sum + value, 0) / row.values.length;
          return (
            <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              <span style={{
                flex: '0 0 108px',
                fontSize: '0.72rem',
                color: 'var(--ink-2)',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {row.label}
              </span>
              <Sparkline
                data={row.values}
                color={row.color}
                width={150}
                height={30}
                strokeWidth={1.6}
              />
              <span className={styles.chartValue} style={{ marginLeft: 'auto' }}>
                {latest.toFixed(0)}
                <span className={styles.chartValueUnit}>/100 · avg {avg.toFixed(0)}</span>
              </span>
            </div>
          );
        })}
      </div>

      <ChartInfo>Two 0-100 scores per session: Rate Discipline is how steadily you held stroke rate within its band, and Consistency is how even your pace was stroke to stroke. Higher is smoother rowing.</ChartInfo>
    </div>
  );
}
