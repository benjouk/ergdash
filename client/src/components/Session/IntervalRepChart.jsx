import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { AXIS_TICK, SERIES, TOOLTIP_PROPS } from '../../styles/chartTheme.js';

// Bars encode speed (m/s) so a faster rep reads as a taller bar; the tooltip
// translates back to pace. Rest intervals render as muted stubs between reps.
function speedFromPace(paceMs) {
  if (!paceMs || paceMs <= 0) return null;
  return 500 / (paceMs / 1000);
}

export default function IntervalRepChart({ intervals, formatPace }) {
  const data = useMemo(() => {
    if (!intervals?.length) return [];
    let rep = 0;
    return intervals.map(interval => {
      const isWork = interval.type !== 'rest';
      if (isWork) rep += 1;
      return {
        label: isWork ? `${rep}` : 'rest',
        isWork,
        speed: speedFromPace(interval.pace_ms),
        pace_ms: interval.pace_ms,
        stroke_rate: interval.stroke_rate > 0 ? interval.stroke_rate : null,
        heart_rate: interval.heart_rate_avg > 0 ? interval.heart_rate_avg : null,
        time_ms: interval.time_ms,
        distance: interval.distance,
      };
    });
  }, [intervals]);

  const workReps = data.filter(d => d.isWork && d.speed != null);
  if (workReps.length < 2) return null;

  const hasHr = data.some(d => d.heart_rate != null);
  const hasRate = data.some(d => d.isWork && d.stroke_rate != null);

  return (
    <ResponsiveContainer width="100%" height={185}>
      <ComposedChart data={data} margin={{ top: 8, right: hasHr ? 8 : 0, bottom: 0, left: 0 }} barCategoryGap="18%">
        <XAxis
          dataKey="label"
          tick={AXIS_TICK}
          axisLine={{ stroke: 'var(--rule)' }}
          tickLine={false}
          interval={0}
          tickFormatter={v => (v === 'rest' ? '' : v)}
        />
        <YAxis
          yAxisId="speed"
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={56}
          domain={[0, 'dataMax + 0.5']}
          tickFormatter={v => (v > 0 ? formatPace(Math.round((500 / v) * 1000)) : '')}
        />
        {hasHr && (
          <YAxis
            yAxisId="hr"
            orientation="right"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={38}
            domain={['dataMin - 10', 'dataMax + 10']}
          />
        )}
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value, name, item) => {
            if (name === 'Pace') {
              return [item?.payload?.pace_ms ? formatPace(item.payload.pace_ms) : '--', 'Pace'];
            }
            if (name === 'Rate') return [`${Number(value).toFixed(1)} spm`, 'Rate'];
            if (name === 'HR') return [`${Math.round(value)} bpm`, 'HR'];
            return [value, name];
          }}
          labelFormatter={(label, payload) => {
            const row = payload?.[0]?.payload;
            if (!row) return label;
            const meters = row.distance ? `${row.distance}m` : '';
            return row.isWork ? `Rep ${label} ${meters}`.trim() : `Rest ${meters}`.trim();
          }}
        />
        <Bar yAxisId="speed" dataKey="speed" name="Pace" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell
              key={index}
              fill={entry.isWork ? SERIES.secondary : 'var(--rule)'}
              fillOpacity={entry.isWork ? 0.9 : 0.6}
            />
          ))}
        </Bar>
        {hasRate && (
          <YAxis yAxisId="rate" hide domain={['dataMin - 2', 'dataMax + 2']} />
        )}
        {hasRate && (
          <Line
            yAxisId="rate"
            dataKey={d => (d.isWork ? d.stroke_rate : null)}
            name="Rate"
            stroke={SERIES.tertiary}
            strokeWidth={0}
            dot={{ r: 3, fill: SERIES.tertiary }}
            connectNulls
          />
        )}
        {hasHr && (
          <Line
            yAxisId="hr"
            type="monotone"
            dataKey="heart_rate"
            name="HR"
            stroke={SERIES.hr}
            strokeWidth={1.8}
            dot={{ r: 3, fill: SERIES.hr }}
            connectNulls
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
