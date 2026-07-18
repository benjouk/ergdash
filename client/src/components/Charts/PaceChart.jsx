import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Dot } from 'recharts';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import TrendChip, { seriesDelta } from './TrendChip.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

const TAG_COLORS = {
  endurance: SERIES.primary,
  interval: SERIES.secondary,
};

// Trailing sessions folded into the rolling-average line - enough to smooth
// session-to-session noise without lagging behind real trends.
const SMOOTH_WINDOW = 7;

function CustomDot(props) {
  const { cx, cy, payload } = props;
  const color = TAG_COLORS[payload.inferred_tag] || SERIES.primary;
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke="none" />;
}

export default function PaceChart({ tag = 'endurance', title = 'Steady Pace' }) {
  const { formatPace } = useUnits();
  const { from, to } = useTimeRange();
  const { data = [], loading, error, retry } = useChartData(() => {
    const params = { metric: 'pace', period: 'all', tag };
    if (from) params.from = from;
    if (to) params.to = to;
    return api.getTrends(params).then(d => d.pace_trend || []);
  }, [from, tag, to]);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title={title} message="Couldn't load chart data." error onRetry={retry} />;
  if (data.length === 0) return <ChartEmpty title={title} message="Not enough comparable steady sessions in this range yet." />;

  const formatted = data.map((d, i) => {
    const window = data.slice(Math.max(0, i - SMOOTH_WINDOW + 1), i + 1);
    return {
      ...d,
      pace_avg: Math.round(window.reduce((s, p) => s + p.pace_ms, 0) / window.length),
      dateShort: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    };
  });

  const latest = formatted[formatted.length - 1];
  // Lower pace_ms is faster, so an improving trend reads as a downward delta.
  const paceDelta = seriesDelta(formatted, 'pace_avg');

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          {title}
        </div>
        <div className={styles.chartMetric}>
          <div className={styles.chartValue}>
            {formatPace(latest.pace_avg)}
            <span className={styles.chartValueUnit}>{SMOOTH_WINDOW}-session avg</span>
          </div>
          <TrendChip delta={paceDelta} betterWhenUp={false}>
            {paceDelta != null ? `${(Math.abs(paceDelta) / 1000).toFixed(1)}s` : ''}
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
            reversed
            tick={AXIS_TICK}
            tickFormatter={v => formatPace(v)}
            axisLine={false}
            tickLine={false}
            width={55}
            domain={['dataMin - 2000', 'dataMax + 2000']}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(v, name) => [formatPace(v), name]}
          />
          {/* Per-session pace: de-emphasised so the eye reads the trend, with
              tag-coloured dots keeping the endurance/interval distinction. */}
          <Line
            type="monotone"
            dataKey="pace_ms"
            name="Session"
            stroke="var(--ink-3)"
            strokeWidth={1}
            strokeOpacity={0.4}
            dot={<CustomDot />}
            activeDot={{ r: 5, stroke: SERIES.primary, fill: 'var(--surface)' }}
          />
          {/* Rolling average: the signal through the noise. */}
          <Line
            type="monotone"
            dataKey="pace_avg"
            name={`${SMOOTH_WINDOW}-session avg`}
            stroke={SERIES.primary}
            strokeWidth={2.5}
            dot={false}
            activeDot={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <ChartInfo>Comparable steady sessions only: each average pace plus a {SMOOTH_WINDOW}-session rolling average that cuts through day-to-day noise. The scale is flipped so higher points are faster.</ChartInfo>
    </div>
  );
}
