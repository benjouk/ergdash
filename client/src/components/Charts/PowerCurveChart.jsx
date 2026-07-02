import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { AXIS_TICK, AXIS_LINE, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import styles from './Charts.module.css';

const DURATION_LABELS = { 60: '1′', 240: '4′', 600: '10′', 1800: '30′', 3600: '60′' };

// Power-duration curve: best sustained watts over each window, with a ghost
// line showing where those bests stood 90 days ago.
export default function PowerCurveChart() {
  const [data, setData] = useState(null);
  const { formatPace } = useUnits();
  const navigate = useNavigate();

  useEffect(() => {
    api.getPowerCurve()
      .then(setData)
      .catch(() => {});
  }, []);

  const merged = useMemo(() => {
    if (!data) return [];
    const byDuration = new Map();
    for (const p of data.curve || []) {
      byDuration.set(p.duration_s, { ...p, current: p.avg_watts });
    }
    for (const p of data.ghost || []) {
      const row = byDuration.get(p.duration_s) || { duration_s: p.duration_s };
      row.ghost = p.avg_watts;
      byDuration.set(p.duration_s, row);
    }
    return [...byDuration.values()].sort((a, b) => a.duration_s - b.duration_s);
  }, [data]);

  if (merged.length < 2) return null;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>Power Curve</div>
        <div className={styles.chartValueUnit} style={{ color: 'var(--ink-3)' }}>
          best watts by duration
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={merged}>
          <XAxis
            dataKey="duration_s"
            type="number"
            scale="log"
            domain={['dataMin', 'dataMax']}
            ticks={merged.map(m => m.duration_s)}
            tickFormatter={d => DURATION_LABELS[d] || `${Math.round(d / 60)}′`}
            tick={AXIS_TICK}
            axisLine={AXIS_LINE}
            tickLine={false}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={v => `${Math.round(v)}w`}
            axisLine={false}
            tickLine={false}
            width={48}
            domain={['dataMin - 20', 'dataMax + 20']}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            labelFormatter={d => `Best ${DURATION_LABELS[d] || d + 's'}`}
            formatter={(value, name, item) => {
              const paceMs = item?.payload?.avg_pace_ms;
              const watts = `${Math.round(value)}w`;
              const label = name === 'ghost' ? `${data.ghost_days}d ago` : 'Current';
              return [
                name === 'current' && paceMs ? `${watts} (${formatPace(paceMs)})` : watts,
                label,
              ];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
            formatter={v => (v === 'ghost' ? `${data.ghost_days} days ago` : 'Current best')}
          />
          <Line
            type="monotone"
            dataKey="ghost"
            stroke="var(--chart-ref)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={{ r: 3, fill: 'var(--chart-ref)' }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="current"
            stroke={SERIES.primary}
            strokeWidth={2}
            dot={{ r: 4, fill: SERIES.primary, cursor: 'pointer' }}
            activeDot={{
              r: 6,
              cursor: 'pointer',
              onClick: (_, dot) => {
                const workoutId = dot?.payload?.workout_id;
                if (workoutId) navigate(`/session/${workoutId}`);
              },
            }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
