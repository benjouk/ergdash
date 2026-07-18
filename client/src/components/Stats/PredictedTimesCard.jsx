import { TrendingUp } from 'lucide-react';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { distanceLabel } from '../PBBadge.jsx';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartInfo from '../Charts/ChartInfo.jsx';
import { useChartData } from '../Charts/useChartData.js';
import chartStyles from '../Charts/Charts.module.css';
import styles from './PredictedTimesCard.module.css';

export function deltaVsPb(deltaMs) {
  if (deltaMs == null) return '—';
  const seconds = Math.abs(deltaMs) / 1000;
  return `${deltaMs > 0 ? '+' : '-'}${seconds.toFixed(1)}s`;
}

// Current predicted time at every benchmark distance, from the same trend
// engine the Targets and Race Plan cards use. This is current-state data rather
// than a range trend, so the fixed window is named explicitly in the header.
export default function PredictedTimesCard() {
  const { formatTime, formatPace } = useUnits();
  const { data, loading, error } = useChartData(() => api.getPredictedTimes(), []);

  if (loading) return <ChartSkeleton />;

  const rows = data?.predicted_times || [];
  const doublingS = data ? (data.pace_per_doubling_ms / 1000).toFixed(1) : null;

  return (
    <section className={chartStyles.chartCard}>
      <div className={chartStyles.chartHeader}>
        <div className={chartStyles.chartTitle}>Predicted Times</div>
        <div className={styles.headingMeta}>
          <TrendingUp size={15} aria-hidden="true" /> current projection
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Distance</th>
                  <th>Predicted</th>
                  <th>/500m</th>
                  <th>vs PB</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.distance}>
                    <td>{distanceLabel(row.distance)}</td>
                    <td
                      title={row.source === 'trend'
                        ? `Projected from ${row.sample_size} recent hard ${distanceLabel(row.distance)} results`
                        : `Estimated from your ${distanceLabel(row.anchor_distance)} trend`}
                    >
                      {row.source === 'estimated' && '~'}{formatTime(row.predicted_time_ms)}
                    </td>
                    <td>{formatPace(row.pace_ms)}</td>
                    <td>{deltaVsPb(row.delta_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.note}>
            Plain rows project recent hard results at that distance to today. ~ rows are
            estimated from the nearest trained distance at {doublingS}s per doubling
            {data.doubling_source === 'fitted' ? ', fitted to your results' : " (Paul's Law)"}.
          </p>
        </>
      ) : (
        <div className={styles.empty}>
          {error
            ? 'Predictions are unavailable right now.'
            : 'Row a few hard benchmark pieces and predictions will appear here.'}
        </div>
      )}

      <ChartInfo>Current benchmark projections use recent hard results and do not change with the page range selector.</ChartInfo>
    </section>
  );
}
