import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { api } from '../../api.js';
import { AXIS_TICK, AXIS_LINE, REF_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import styles from './Charts.module.css';

const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function CumulativeMetersChart() {
  const [series, setSeries] = useState(null);

  useEffect(() => {
    api.getCumulative()
      .then(setSeries)
      .catch(() => setSeries(null));
  }, []);

  const data = useMemo(() => {
    if (!series) return [];
    const byDoy = new Map();
    for (const p of series.current || []) {
      byDoy.set(p.doy, { doy: p.doy, current: p.cum_m });
    }
    for (const p of series.compare || []) {
      const row = byDoy.get(p.doy) || { doy: p.doy };
      row.compare = p.cum_m;
      byDoy.set(p.doy, row);
    }
    const rows = [...byDoy.values()].sort((a, b) => a.doy - b.doy);
    if (series.goal_m) {
      for (const row of rows) {
        row.goal = Math.round((series.goal_m * row.doy) / 365);
      }
    }
    return rows;
  }, [series]);

  if (!series || data.length === 0) return null;

  const currentPoints = series.current || [];
  const latest = currentPoints[currentPoints.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>Cumulative Metres</div>
        <div className={styles.chartValue}>
          {latest ? `${(latest.cum_m / 1000).toFixed(0)}k` : '--'}
          <span className={styles.chartValueUnit}>{series.year}</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <XAxis
            dataKey="doy"
            type="number"
            domain={[1, 366]}
            ticks={MONTH_STARTS}
            tickFormatter={doy => MONTH_NAMES[MONTH_STARTS.indexOf(doy)] ?? ''}
            tick={AXIS_TICK}
            axisLine={AXIS_LINE}
            tickLine={false}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
            axisLine={false}
            tickLine={false}
            width={45}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(v, name) => [`${Number(v).toLocaleString()}m`, name]}
            labelFormatter={doy => `Day ${doy}`}
          />
          <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
          <Line
            type="monotone"
            dataKey="current"
            name={String(series.year)}
            stroke={SERIES.primary}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          {(series.compare || []).length > 0 && (
            <Line
              type="monotone"
              dataKey="compare"
              name={String(series.compare_year)}
              stroke={SERIES.secondary}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
            />
          )}
          {series.goal_m && (
            <Line
              type="linear"
              dataKey="goal"
              name="Goal"
              stroke={REF_LINE.stroke}
              strokeDasharray={REF_LINE.strokeDasharray}
              strokeWidth={1.2}
              dot={false}
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
