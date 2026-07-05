import { useMemo } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

const BAND = 5;

function DragDot(props) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const outside = Math.abs(payload.drag_delta ?? 0) > BAND;
  return <circle cx={cx} cy={cy} r={3} fill={outside ? SERIES.hr : SERIES.primary} stroke="none" />;
}

export default function DragFactorChart() {
  const { from, to } = useTimeRange();
  const { data = [], loading, error, retry } = useChartData(() => {
    const params = { metric: 'drag', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    return api.getTrends(params).then(d => d.drag_trend || []);
  }, [from, to]);

  const formatted = useMemo(() => data.map(d => {
    // drag_delta is deviation from the 30-workout rolling average, so the
    // band centre is recoverable without refetching strokes.
    const mean = d.drag_delta != null ? d.drag_factor - d.drag_delta : d.drag_factor;
    return {
      ...d,
      band: [mean - BAND, mean + BAND],
      dateShort: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    };
  }), [data]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Drag Factor" message="Couldn't load chart data." error onRetry={retry} />;
  if (formatted.length < 2) return <ChartEmpty title="Drag Factor" />;

  const latest = formatted[formatted.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Drag Factor
        </div>
        <div className={styles.chartValue}>
          {latest.drag_factor}
          <span className={styles.chartValueUnit}>latest</span>
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
          />
          <YAxis
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={['dataMin - 5', 'dataMax + 5']}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(v, name) => {
              if (name === 'band') return null;
              return [v, 'Drag factor'];
            }}
          />
          <Area
            dataKey="band"
            stroke="none"
            fill={SERIES.primaryBg}
            fillOpacity={1}
            activeDot={false}
            legendType="none"
            name="band"
          />
          <Line
            type="monotone"
            dataKey="drag_factor"
            stroke={SERIES.primary}
            strokeWidth={1.5}
            dot={<DragDot />}
            activeDot={{ r: 5, stroke: SERIES.primary, fill: 'var(--surface)' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    
      <ChartInfo>The drag factor recorded for each session, with a band of ±5 around your 30-workout rolling average. Highlighted dots outside the band flag a damper or fan change that can skew pace comparisons.</ChartInfo>
    </div>
  );
}
