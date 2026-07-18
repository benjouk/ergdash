import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

export default function PlanAdherenceChart() {
  const { from, to, rangeKey } = useTimeRange();
  const { data = [], loading, error, retry } = useChartData(
    () => {
      const params = {};
      // Supplying an explicit floor makes All Time genuinely all-time while
      // preserving the endpoint's 12-week default for other callers.
      if (rangeKey === 'all') params.from = '1900-01-01';
      else if (from) params.from = from;
      if (to) params.to = to;
      return api.getPlanAdherence(params).then(d => d.weeks || []);
    },
    [from, rangeKey, to]
  );

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Plan Adherence" message="Couldn't load chart data." error onRetry={retry} />;
  if (data.length === 0) {
    return <ChartEmpty title="Plan Adherence" message="No planned workouts yet. Schedule sessions on the Plan page to track adherence." />;
  }

  const completed = data.reduce((s, w) => s + w.completed, 0);
  const missed = data.reduce((s, w) => s + w.missed, 0);
  const followed = completed + missed > 0
    ? Math.round((completed / (completed + missed)) * 100)
    : 100;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>Plan Adherence</div>
        <div className={styles.chartValue}>
          {followed}%
          <span className={styles.chartValueUnit}>plans completed</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={data} barCategoryGap="25%">
          <XAxis
            dataKey="week"
            tick={AXIS_TICK}
            tickFormatter={w => w.split('-W')[1] ? `W${w.split('-W')[1]}` : w}
            axisLine={AXIS_LINE}
            tickLine={false}
          />
          <YAxis
            yAxisId="sessions"
            allowDecimals={false}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={26}
          />
          <YAxis
            yAxisId="meters"
            orientation="right"
            tick={AXIS_TICK}
            tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
            axisLine={false}
            tickLine={false}
            width={38}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(value, name) => {
              if (name === 'planned m' || name === 'actual m') {
                return [`${Number(value).toLocaleString()}m`, name];
              }
              return [value, name];
            }}
            labelFormatter={w => `Week ${w.split('-W')[1] || w}`}
          />
          <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
          <Bar yAxisId="sessions" dataKey="completed" name="completed" stackId="p" fill={SERIES.primary} />
          <Bar yAxisId="sessions" dataKey="missed" name="missed" stackId="p" fill="var(--negative)" />
          <Bar yAxisId="sessions" dataKey="skipped" name="skipped" stackId="p" fill="var(--chart-ref)" radius={[4, 4, 0, 0]} />
          <Line
            yAxisId="meters"
            dataKey="planned_meters"
            name="planned m"
            stroke={SERIES.tertiary}
            strokeDasharray="4 3"
            dot={false}
            strokeWidth={1.5}
          />
          <Line
            yAxisId="meters"
            dataKey="actual_meters"
            name="actual m"
            stroke={SERIES.secondary}
            dot={false}
            strokeWidth={1.5}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <ChartInfo>
        How well training followed the plan, week by week: bars count planned sessions that were
        completed, missed, or skipped, and the lines compare planned metres against the metres
        actually rowed in matched sessions.
      </ChartInfo>
    </div>
  );
}
