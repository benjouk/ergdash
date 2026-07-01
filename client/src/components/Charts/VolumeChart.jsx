import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, REF_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import styles from './Charts.module.css';

export default function VolumeChart() {
  const [data, setData] = useState([]);
  const { from, to } = useTimeRange();

  useEffect(() => {
    const params = { metric: 'volume', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    api.getTrends(params)
      .then(d => {
        const rows = d.weekly_volume || [];
        setData(from ? rows : rows.slice(-12));
      })
      .catch(() => {});
  }, [from, to]);

  if (data.length === 0) return null;

  const avg = data.reduce((s, d) => s + d.distance, 0) / data.length;
  const latest = data[data.length - 1];

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>Weekly Volume</div>
        <div className={styles.chartValue}>
          {(latest.distance / 1000).toFixed(1)}k
          <span className={styles.chartValueUnit}>this week</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barCategoryGap="20%">
          <XAxis
            dataKey="week"
            tick={AXIS_TICK}
            tickFormatter={w => w.split('-W')[1] ? `W${w.split('-W')[1]}` : w}
            axisLine={AXIS_LINE}
            tickLine={false}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(v) => [`${v.toLocaleString()}m`, 'Distance']}
            labelFormatter={w => `Week ${w.split('-W')[1] || w}`}
          />
          <ReferenceLine y={avg} {...REF_LINE} />
          <Bar dataKey="steady_m" stackId="a" fill={SERIES.primary} radius={[0, 0, 0, 0]} />
          <Bar dataKey="interval_m" stackId="a" fill={SERIES.secondary} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
