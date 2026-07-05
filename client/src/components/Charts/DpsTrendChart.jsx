import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

// Monthly average distance per stroke — a stroke-length proxy that surfaces
// long-term technique changes.
export default function DpsTrendChart() {
  const { from, to } = useTimeRange();
  const { data = [], loading, error, retry } = useChartData(() => {
    const params = { metric: 'dps', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    return api.getTrends(params).then(d => d.dps_trend || []);
  }, [from, to]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Distance Per Stroke" message="Couldn't load chart data." error onRetry={retry} />;
  if (data.length < 2) return <ChartEmpty title="Distance Per Stroke" />;

  const latest = data[data.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Distance Per Stroke
          <ChartInfo>Average metres travelled per stroke, by month. Longer strokes at the same effort usually reflect improving technique.</ChartInfo>
        </div>
        <div className={styles.chartValue}>
          {latest.dps.toFixed(2)}
          <span className={styles.chartValueUnit}>m/stroke</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} barCategoryGap="25%">
          <XAxis
            dataKey="month"
            tick={AXIS_TICK}
            tickFormatter={m => {
              const [y, mo] = m.split('-');
              return new Date(Number(y), Number(mo) - 1).toLocaleDateString('en-GB', { month: 'short' });
            }}
            axisLine={AXIS_LINE}
            tickLine={false}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={v => v.toFixed(1)}
            axisLine={false}
            tickLine={false}
            width={38}
            domain={['dataMin - 0.5', 'dataMax + 0.5']}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(v, name, item) => [
              `${Number(v).toFixed(2)} m/stroke (${item?.payload?.sessions} sessions)`,
              'Avg DPS',
            ]}
          />
          <Bar dataKey="dps" fill={SERIES.tertiary} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
