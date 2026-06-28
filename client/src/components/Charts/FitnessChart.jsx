import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../../api.js';
import styles from './Charts.module.css';

export default function FitnessChart({ compact = false }) {
  const [data, setData] = useState([]);

  useEffect(() => {
    const from = new Date(Date.now() - (compact ? 30 : 90) * 86400000).toISOString().slice(0, 10);
    api.getFitness({ from })
      .then(d => setData(d.fitness_log || []))
      .catch(() => {});
  }, [compact]);

  if (data.length === 0) return null;

  const height = compact ? 80 : 200;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartTitle}>Fitness / Fatigue / Form</div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data}>
          {!compact && (
            <>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
                tickFormatter={d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                axisLine={{ stroke: 'var(--rule)' }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--ink-3)' }}
                axisLine={false}
                tickLine={false}
                width={35}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--rule)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8rem',
                }}
                formatter={(v, name) => [v.toFixed(1), name]}
              />
            </>
          )}
          <ReferenceLine y={0} stroke="var(--rule)" />
          <Area type="monotone" dataKey="fitness" stroke="var(--accent)" fill="var(--accent-bg)" strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="fatigue" stroke="var(--hot)" fill="var(--hot-bg)" strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="form" stroke="var(--accent-2)" fill="var(--accent-2-bg)" strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
