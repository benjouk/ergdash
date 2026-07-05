import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_LINE, AXIS_TICK, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { distanceLabel } from '../PBBadge.jsx';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

const LINE_COLORS = [
  SERIES.tertiary,
  SERIES.primary,
  SERIES.secondary,
  'var(--positive)',
  'var(--hr)',
  'var(--zone-1)',
  'var(--zone-4)',
  'var(--ink-2)',
];

export default function PbTimelineChart() {
  const { formatPace } = useUnits();
  const { from, to } = useTimeRange();
  const { data = [], loading, error, retry } = useChartData(() => {
    const params = {};
    if (from) params.since = from;
    return api.getPbHistory(params).then(result => {
      const rows = result.pb_history || [];
      return to ? rows.filter(row => row.achieved_at < to) : rows;
    });
  }, [from, to]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="PB Progression" message="Couldn't load chart data." error onRetry={retry} />;
  if (data.length === 0) return <ChartEmpty title="PB Progression" />;

  const distances = [...new Set(data.map(row => row.distance))];
  const chartData = data.map(row => ({
    date: row.achieved_at,
    dateShort: new Date(row.achieved_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    [`d${row.distance}`]: row.pace_ms,
  }));

  const latest = data[data.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          PB Progression
        </div>
        <div className={styles.chartValue}>
          {distanceLabel(latest.distance)}
          <span className={styles.chartValueUnit}>latest</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={chartData}>
          <XAxis
            dataKey="dateShort"
            tick={AXIS_TICK}
            axisLine={AXIS_LINE}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            reversed
            tick={AXIS_TICK}
            tickFormatter={v => formatPace(v)}
            axisLine={false}
            tickLine={false}
            width={55}
            domain={['dataMin - 1000', 'dataMax + 1000']}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(value, key) => [formatPace(value), distanceLabel(Number(String(key).slice(1)))]}
          />
          {distances.map((distance, index) => (
            <Line
              key={distance}
              type="monotone"
              dataKey={`d${distance}`}
              name={distanceLabel(distance)}
              connectNulls
              stroke={LINE_COLORS[index % LINE_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--accent-3)', stroke: 'var(--surface)', strokeWidth: 1 }}
              activeDot={{ r: 5, fill: 'var(--accent-3)', stroke: 'var(--surface)', strokeWidth: 1 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    
      <ChartInfo>Your personal-best pace for each distance over time — every point marks a new PB, and each line tracks one distance.</ChartInfo>
    </div>
  );
}
