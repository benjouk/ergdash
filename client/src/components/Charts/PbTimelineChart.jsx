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

function seriesKey(row) {
  return row.tag === 'interval' ? `i${row.distance}` : `d${row.distance}`;
}

function seriesLabel(key) {
  const isInterval = key.startsWith('i');
  const distance = Number(key.slice(1));
  const label = distanceLabel(distance);
  return isInterval ? `${label} (int)` : label;
}

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

  const keys = [...new Set(data.map(row => seriesKey(row)))];
  const chartData = data.map(row => ({
    date: row.achieved_at,
    dateShort: new Date(row.achieved_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    [seriesKey(row)]: row.pace_ms,
  }));

  const latest = data[data.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          PB Progression
        </div>
        <div className={styles.chartValue}>
          {distanceLabel(latest.distance)}{latest.tag === 'interval' ? ' (int)' : ''}
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
            minTickGap={24}
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
            formatter={(value, key) => [formatPace(value), seriesLabel(String(key))]}
          />
          {keys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={seriesLabel(key)}
              connectNulls
              stroke={LINE_COLORS[index % LINE_COLORS.length]}
              strokeWidth={2}
              strokeDasharray={key.startsWith('i') ? '6 3' : undefined}
              dot={{ r: 3, fill: 'var(--accent-3)', stroke: 'var(--surface)', strokeWidth: 1 }}
              activeDot={{ r: 5, fill: 'var(--accent-3)', stroke: 'var(--surface)', strokeWidth: 1 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <ChartInfo>Your personal-best pace for each distance over time. Every point marks a new PB. Solid lines are endurance; dashed lines are interval.</ChartInfo>
    </div>
  );
}
