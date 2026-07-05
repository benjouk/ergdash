import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { AXIS_TICK, AXIS_LINE, ZONES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
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
  const { from, to } = useTimeRange();
  const { data: chartData, loading, error, retry } = useChartData(async () => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;

    const [zones, polarization] = await Promise.all([
      api.getZones({ ...params, group: 'week' }),
      api.getPolarization(params),
    ]);

    return {
      zoneWeeks: from ? (zones.weeks || []) : (zones.weeks || []).slice(-12),
      polarWeeks: from ? (polarization.weeks || []) : (polarization.weeks || []).slice(-12),
      zoneModel: zones.zone_model,
    };
  }, [from, to]);

  const zoneWeeks = chartData?.zoneWeeks || [];
  const polarWeeks = chartData?.polarWeeks || [];
  const zoneModel = chartData?.zoneModel;
  const data = mode === 'time' ? zoneWeeks : polarWeeks;
  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title={mode === 'time' ? 'Time in Zone' : 'Polarization'} message="Couldn't load chart data." error onRetry={retry} />;
  if (!zoneModel || zoneWeeks.length === 0) return <ChartEmpty title={mode === 'time' ? 'Time in Zone' : 'Polarization'} />;

  const height = compact ? 160 : 220;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          {mode === 'time' ? 'Time in Zone' : 'Polarization'}
          <ChartInfo>
            {mode === 'time'
              ? 'Hours spent in each heart-rate zone per week, stacked from easy (Z1) to max (Z5). Zones are derived from your max heart rate.'
              : 'Each week of training split into easy, moderate and hard as a share of total time. Polarized training keeps most work easy, a little hard, and not much in between.'}
          </ChartInfo>
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
