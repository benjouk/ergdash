import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Dot } from 'recharts';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import styles from './Charts.module.css';

const TAG_COLORS = {
  endurance: 'var(--accent)',
  interval: 'var(--accent-2)',
  test: 'var(--hot)',
  warmup: 'var(--ink-3)',
};

function CustomDot(props) {
  const { cx, cy, payload } = props;
  const color = TAG_COLORS[payload.inferred_tag] || 'var(--accent)';
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke="none" />;
}

export default function PaceChart() {
  const [data, setData] = useState([]);
  const { formatPace } = useUnits();

  useEffect(() => {
    api.getTrends({ metric: 'pace', period: '90d' })
      .then(d => {
        const rows = d.pace_trend || [];
        if (rows.length > 0) return setData(rows);
        return api.getTrends({ metric: 'pace', period: 'all' })
          .then(d2 => setData(d2.pace_trend || []));
      })
      .catch(() => {});
  }, []);

  if (data.length === 0) return null;

  const formatted = data.map(d => ({
    ...d,
    dateShort: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }));

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>Pace Trend</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={formatted}>
          <XAxis
            dataKey="dateShort"
            tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
            axisLine={{ stroke: 'var(--rule)' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            reversed
            tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
            tickFormatter={v => formatPace(v)}
            axisLine={false}
            tickLine={false}
            width={55}
            domain={['dataMin - 2000', 'dataMax + 2000']}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
            }}
            formatter={(v) => [formatPace(v), 'Pace']}
          />
          <Line
            type="monotone"
            dataKey="pace_ms"
            stroke="var(--accent)"
            strokeWidth={1.5}
            dot={<CustomDot />}
            activeDot={{ r: 5, stroke: 'var(--accent)', fill: 'var(--surface)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
