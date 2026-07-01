import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Dot } from 'recharts';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import styles from './Charts.module.css';

const TAG_COLORS = {
  endurance: SERIES.primary,
  interval: SERIES.secondary,
};

function CustomDot(props) {
  const { cx, cy, payload } = props;
  const color = TAG_COLORS[payload.inferred_tag] || SERIES.primary;
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke="none" />;
}

export default function PaceChart() {
  const [data, setData] = useState([]);
  const { formatPace } = useUnits();
  const { from, to } = useTimeRange();

  useEffect(() => {
    const params = { metric: 'pace', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    api.getTrends(params)
      .then(d => setData(d.pace_trend || []))
      .catch(() => {});
  }, [from, to]);

  if (data.length === 0) return null;

  const formatted = data.map(d => ({
    ...d,
    dateShort: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }));

  const latest = data[data.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>Pace Trend</div>
        <div className={styles.chartValue}>
          {formatPace(latest.pace_ms)}
          <span className={styles.chartValueUnit}>latest</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={formatted}>
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
            domain={['dataMin - 2000', 'dataMax + 2000']}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(v) => [formatPace(v), 'Pace']}
          />
          <Line
            type="monotone"
            dataKey="pace_ms"
            stroke={SERIES.primary}
            strokeWidth={2}
            dot={<CustomDot />}
            activeDot={{ r: 5, stroke: SERIES.primary, fill: 'var(--surface)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
