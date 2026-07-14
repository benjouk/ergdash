import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import TrendChip, { seriesDelta } from './TrendChip.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

// Aerobic decoupling per steady session; below the 5% line means the aerobic
// base held up for the whole workout.
export default function HrDriftChart() {
  const { from, to } = useTimeRange();
  const { data = [], loading, error, retry } = useChartData(() => {
    const params = { metric: 'hr_drift', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    return api.getTrends(params).then(d => d.hr_drift_trend || []);
  }, [from, to]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="HR Drift" message="Couldn't load chart data." error onRetry={retry} />;
  if (data.length < 3) return <ChartEmpty title="HR Drift" />;

  const formatted = data.map(d => ({
    ...d,
    dateShort: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }));
  const latest = formatted[formatted.length - 1];
  // Less aerobic drift is better, so a falling trend is the improvement.
  const driftDelta = seriesDelta(formatted, 'hr_drift_pct');

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          HR Drift
        </div>
        <div className={styles.chartMetric}>
          <div className={styles.chartValue}>
            {latest.hr_drift_pct > 0 ? '+' : ''}{latest.hr_drift_pct.toFixed(1)}%
            <span className={styles.chartValueUnit}>latest</span>
          </div>
          <TrendChip delta={driftDelta} betterWhenUp={false}>
            {driftDelta != null ? `${Math.abs(driftDelta).toFixed(1)}%` : ''}
          </TrendChip>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={formatted}>
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
            tickFormatter={v => `${v}%`}
            axisLine={false}
            tickLine={false}
            width={40}
            allowDecimals={false}
            domain={[min => Math.floor(min - 2), max => Math.ceil(max + 2)]}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={v => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}%`, 'Drift']}
          />
          <ReferenceLine
            y={5}
            stroke="var(--chart-ref)"
            strokeDasharray="3 3"
            label={{
              value: 'coupled < 5%',
              position: 'insideTopRight',
              fill: 'var(--ink-3)',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
            }}
          />
          <ReferenceLine y={0} stroke="var(--chart-grid)" />
          <Line
            type="monotone"
            dataKey="hr_drift_pct"
            stroke={SERIES.hr}
            strokeWidth={2}
            dot={{ r: 3, fill: SERIES.hr }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    
      <ChartInfo>How much heart rate rose from the first half to the second half of steady sessions (aerobic decoupling). Staying under the 5% line means your aerobic base lasted the whole workout.</ChartInfo>
    </div>
  );
}
