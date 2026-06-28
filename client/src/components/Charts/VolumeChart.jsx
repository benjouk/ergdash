import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../../api.js';
import styles from './Charts.module.css';

export default function VolumeChart() {
  const [data, setData] = useState([]);

  useEffect(() => {
    api.getTrends({ metric: 'volume', period: '12w' })
      .then(d => {
        const rows = d.weekly_volume || [];
        if (rows.length > 0) return setData(rows);
        return api.getTrends({ metric: 'volume', period: 'all' })
          .then(d2 => setData((d2.weekly_volume || []).slice(-12)));
      })
      .catch(() => {});
  }, []);

  if (data.length === 0) return null;

  const avg = data.reduce((s, d) => s + d.distance, 0) / data.length;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>Weekly Volume</div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} barCategoryGap="20%">
          <XAxis
            dataKey="week"
            tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
            tickFormatter={w => w.split('-W')[1] ? `W${w.split('-W')[1]}` : w}
            axisLine={{ stroke: 'var(--rule)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
            tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
            }}
            formatter={(v) => [`${v.toLocaleString()}m`, 'Distance']}
            labelFormatter={w => `Week ${w.split('-W')[1] || w}`}
          />
          <ReferenceLine y={avg} stroke="var(--ink-3)" strokeDasharray="3 3" />
          <Bar dataKey="endurance_m" stackId="a" fill="var(--accent)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="interval_m" stackId="a" fill="var(--accent-2)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
