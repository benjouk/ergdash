import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, ZONES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import styles from './Charts.module.css';

function formatHours(seconds) {
  const h = seconds / 3600;
  return h >= 10 ? `${h.toFixed(0)}h` : `${h.toFixed(1)}h`;
}

const POLAR_COLORS = {
  easy_pct: 'var(--zone-2)',
  moderate_pct: 'var(--zone-3)',
  hard_pct: 'var(--zone-5)',
};

// Weekly time in HR zones. mode="time": stacked Z1–Z5 hours.
// mode="percent3": 100%-stacked easy/moderate/hard polarization view.
export default function ZoneStackChart({ compact = false }) {
  const [mode, setMode] = useState('time');
  const [zoneWeeks, setZoneWeeks] = useState([]);
  const [polarWeeks, setPolarWeeks] = useState([]);
  const [zoneModel, setZoneModel] = useState(null);
  const { from, to } = useTimeRange();

  useEffect(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    api.getZones({ ...params, group: 'week' })
      .then(d => {
        setZoneWeeks(from ? (d.weeks || []) : (d.weeks || []).slice(-12));
        setZoneModel(d.zone_model);
      })
      .catch(() => {});
    api.getPolarization(params)
      .then(d => setPolarWeeks(from ? (d.weeks || []) : (d.weeks || []).slice(-12)))
      .catch(() => {});
  }, [from, to]);

  const data = mode === 'time' ? zoneWeeks : polarWeeks;
  if (!zoneModel || zoneWeeks.length === 0) return null;

  const height = compact ? 160 : 220;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          {mode === 'time' ? 'Time in Zone' : 'Polarization'}
          {zoneModel.estimated && (
            <span
              className={styles.chartValueUnit}
              title="Max HR estimated from observed data — set it in Settings"
            >
              est. max {zoneModel.max_hr}
            </span>
          )}
        </div>
        {!compact && (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {['time', 'percent3'].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? 'var(--accent-bg)' : 'transparent',
                  color: mode === m ? 'var(--ink)' : 'var(--ink-3)',
                  border: '1px solid var(--rule)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px 8px',
                  fontSize: '0.68rem',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                }}
              >
                {m === 'time' ? 'zones' : 'easy/hard'}
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} barCategoryGap="20%" stackOffset={mode === 'percent3' ? 'expand' : 'none'}>
          <XAxis
            dataKey="week"
            tick={AXIS_TICK}
            tickFormatter={w => (w.split('-W')[1] ? `W${w.split('-W')[1]}` : w)}
            axisLine={AXIS_LINE}
            tickLine={false}
          />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={mode === 'time' ? formatHours : v => `${Math.round(v * 100)}%`}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            {...TOOLTIP_PROPS}
            labelFormatter={w => `Week ${w.split('-W')[1] || w}`}
            formatter={(v, name) => {
              if (mode === 'time') return [formatHours(v), name.toUpperCase()];
              return [`${Number(v).toFixed(0)}%`, name.replace('_pct', '')];
            }}
          />
          {mode === 'time'
            ? [1, 2, 3, 4, 5].map(z => (
              <Bar
                key={z}
                dataKey={`z${z}`}
                name={`z${z}`}
                stackId="zones"
                fill={ZONES[z - 1]}
                radius={z === 5 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              />
            ))
            : ['easy_pct', 'moderate_pct', 'hard_pct'].map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                name={key}
                stackId="polar"
                fill={POLAR_COLORS[key]}
                radius={i === 2 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
