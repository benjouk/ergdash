import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_TICK, TOOLTIP_PROPS } from '../../styles/chartTheme.js';

// Pace profile for sessions without stroke-level data: the summary-derived
// pace samples plotted over session progress, with a real pace axis and the
// session average for reference (higher on the chart is faster).
export default function PaceProfileChart({ profile, avgPaceMs, formatPace, accent = 'var(--accent)' }) {
  const points = (profile || []).filter(pace => pace > 0);
  if (points.length < 2) return null;

  const data = points.map((pace, index) => ({
    progress: (index / (points.length - 1)) * 100,
    pace_ms: pace,
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="paceProfileFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.3} />
            <stop offset="100%" stopColor={accent} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--rule)" strokeDasharray="5 7" />
        <XAxis
          dataKey="progress"
          type="number"
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={v => `${v}%`}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          reversed
          allowDecimals={false}
          tick={AXIS_TICK}
          tickFormatter={v => formatPace(v)}
          axisLine={false}
          tickLine={false}
          width={58}
          domain={['dataMin - 1500', 'dataMax + 1500']}
        />
        {avgPaceMs > 0 && <ReferenceLine y={avgPaceMs} stroke="var(--ink-2)" strokeDasharray="4 4" />}
        <Tooltip
          {...TOOLTIP_PROPS}
          labelFormatter={progress => `${Math.round(progress)}% through`}
          formatter={value => [formatPace(value), 'Pace']}
        />
        <Area
          type="monotone"
          dataKey="pace_ms"
          stroke={accent}
          strokeWidth={2}
          fill="url(#paceProfileFill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
