import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, REF_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

export default function VolumeChart() {
  const { from, to } = useTimeRange();
  const [weeklyGoal, setWeeklyGoal] = useState(null);

  useEffect(() => {
    api.getGoals().then(d => {
      const goal = (d.goals || []).find(g =>
        g.kind === 'volume' && g.period === 'weekly' && g.active);
      setWeeklyGoal(goal ? goal.target_meters : null);
    }).catch(() => {});
  }, []);
  const { data = [], loading, error, retry } = useChartData(() => {
    // Weekly buckets are produced by /api/stats/trends, so the client-side
    // week_start preference is not applied here yet.
    const params = { metric: 'volume', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    return api.getTrends(params).then(d => {
      const rows = d.weekly_volume || [];
      return from ? rows : rows.slice(-12);
    });
  }, [from, to]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Weekly Volume" message="Couldn't load chart data." error onRetry={retry} />;
  if (data.length === 0) return <ChartEmpty title="Weekly Volume" />;

  const avg = data.reduce((s, d) => s + d.distance, 0) / data.length;
  const latest = data[data.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Weekly Volume
        </div>
        <div className={styles.chartValue}>
          {(latest.distance / 1000).toFixed(1)}k
          <span className={styles.chartValueUnit}>latest week</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} barCategoryGap="20%">
          <XAxis
            dataKey="week"
            tick={AXIS_TICK}
            tickFormatter={w => w.split('-W')[1] ? `W${w.split('-W')[1]}` : w}
            axisLine={AXIS_LINE}
            tickLine={false}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(v) => [`${v.toLocaleString()}m`, 'Distance']}
            labelFormatter={w => `Week ${w.split('-W')[1] || w}`}
          />
          <ReferenceLine y={avg} {...REF_LINE} />
          {weeklyGoal > 0 && (
            <ReferenceLine
              y={weeklyGoal}
              stroke={SERIES.tertiary}
              strokeDasharray="4 3"
              label={{ value: 'goal', position: 'insideTopRight', fontSize: 10, fill: SERIES.tertiary }}
            />
          )}
          <Bar dataKey="steady_m" stackId="a" fill={SERIES.primary} radius={[0, 0, 0, 0]} />
          <Bar dataKey="interval_m" stackId="a" fill={SERIES.secondary} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <ChartInfo>Total metres rowed each week. The dashed line marks the average across the weeks shown; the gold line marks your weekly volume goal when one is set.</ChartInfo>
    </div>
  );
}
