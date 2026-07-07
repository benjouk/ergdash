import { useMemo } from 'react';
import { ComposedChart, Line, Scatter, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

const SMOOTH_WINDOW = 7;

const TAG_COLORS = {
  endurance: SERIES.tertiary,
  interval: SERIES.secondary,
};

// Per-session distance per stroke — a stroke-length proxy that surfaces
// technique changes. Interval sessions naturally sit lower (higher rating,
// shorter strokes), so dots are coloured by session type.
export default function DpsTrendChart() {
  const { from, to } = useTimeRange();
  const { data = [], loading, error, retry } = useChartData(() => {
    const params = { metric: 'dps', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    return api.getTrends(params).then(d => d.dps_trend || []);
  }, [from, to]);

  const formatted = useMemo(() => data.map((d, i) => {
    const window = data.slice(Math.max(0, i - SMOOTH_WINDOW + 1), i + 1);
    return {
      ...d,
      trend: window.reduce((s, p) => s + p.dps, 0) / window.length,
      dateShort: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    };
  }), [data]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Distance Per Stroke" message="Couldn't load chart data." error onRetry={retry} />;
  if (formatted.length < 3) return <ChartEmpty title="Distance Per Stroke" />;

  const latest = formatted[formatted.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Distance Per Stroke
        </div>
        <div className={styles.chartValue}>
          {latest.trend.toFixed(2)}
          <span className={styles.chartValueUnit}>m/stroke</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={formatted}>
          <XAxis
            dataKey="dateShort"
            tick={AXIS_TICK}
            axisLine={AXIS_LINE}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={v => v.toFixed(1)}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={['dataMin - 0.5', 'dataMax + 0.5']}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(v, name) => [
              `${Number(v).toFixed(2)} m/stroke`,
              name === 'trend' ? `${SMOOTH_WINDOW}-session avg` : 'Session',
            ]}
          />
          <Scatter dataKey="dps" name="dps">
            {formatted.map((d, i) => (
              <Cell key={i} fill={TAG_COLORS[d.inferred_tag] || SERIES.tertiary} fillOpacity={0.45} />
            ))}
          </Scatter>
          <Line
            type="monotone"
            dataKey="trend"
            stroke={SERIES.tertiary}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <ChartInfo>Metres travelled per stroke for each session (dots, coloured by session type) with a {SMOOTH_WINDOW}-session average. Longer strokes at the same effort usually reflect improving technique; interval work naturally sits lower.</ChartInfo>
    </div>
  );
}
