import { useState, useEffect, useMemo } from 'react';
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import styles from './Charts.module.css';

const SMOOTH_WINDOW = 7;

// Watts per heartbeat — the slow-moving "am I getting fitter?" line.
export default function EfficiencyChart() {
  const [data, setData] = useState([]);
  const { from, to } = useTimeRange();

  useEffect(() => {
    const params = { metric: 'watts_per_beat', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    api.getTrends(params)
      .then(d => setData(d.watts_per_beat_trend || []))
      .catch(() => {});
  }, [from, to]);

  const formatted = useMemo(() => data.map((d, i) => {
    const window = data.slice(Math.max(0, i - SMOOTH_WINDOW + 1), i + 1);
    return {
      ...d,
      trend: window.reduce((s, p) => s + p.watts_per_beat, 0) / window.length,
      dateShort: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    };
  }), [data]);

  if (formatted.length < 3) return null;

  const latest = formatted[formatted.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>Efficiency</div>
        <div className={styles.chartValue}>
          {latest.trend.toFixed(2)}
          <span className={styles.chartValueUnit}>w/beat</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
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
            tickFormatter={v => v.toFixed(1)}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={['dataMin - 0.1', 'dataMax + 0.1']}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(v, name) => [
              `${Number(v).toFixed(2)} w/beat`,
              name === 'trend' ? '7-session avg' : 'Session',
            ]}
          />
          <Scatter dataKey="watts_per_beat" fill={SERIES.primary} fillOpacity={0.45} />
          <Line
            type="monotone"
            dataKey="trend"
            stroke={SERIES.primary}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
