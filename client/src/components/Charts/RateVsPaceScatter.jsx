import { useMemo, useState, useEffect } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AXIS_TICK, AXIS_LINE, TOOLTIP_PROPS } from '../../styles/chartTheme.js';

// CSS variables can't be interpolated, so resolve the endpoint colors once per
// theme flip and blend in JS.
function parseHexColor(str) {
  const hex = str.trim().replace('#', '');
  if (hex.length !== 6) return null;
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}

function useThemeAttribute() {
  const [themeAttr, setThemeAttr] = useState(
    () => document.documentElement.getAttribute('data-theme')
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeAttr(document.documentElement.getAttribute('data-theme'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return themeAttr;
}

function makeHrColorScale() {
  const rootStyle = getComputedStyle(document.documentElement);
  const cool = parseHexColor(rootStyle.getPropertyValue('--accent-2')) || [6, 135, 245];
  const hot = parseHexColor(rootStyle.getPropertyValue('--hr')) || [224, 45, 60];
  return (t) => {
    const c = cool.map((v, i) => Math.round(v + (hot[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
}

export default function RateVsPaceScatter({ strokes, formatPace }) {
  const themeAttr = useThemeAttribute();

  const points = useMemo(() => {
    const valid = (strokes || []).filter(s => s?.stroke_rate > 0 && s?.pace_ms > 0);
    if (valid.length < 20) return [];

    const hrs = valid.map(s => s.heart_rate).filter(h => h > 0);
    const minHr = hrs.length ? Math.min(...hrs) : 0;
    const maxHr = hrs.length ? Math.max(...hrs) : 0;
    const colorAt = makeHrColorScale();

    return valid.map(s => ({
      stroke_rate: s.stroke_rate,
      pace_ms: s.pace_ms,
      heart_rate: s.heart_rate > 0 ? s.heart_rate : null,
      fill: s.heart_rate > 0 && maxHr > minHr
        ? colorAt((s.heart_rate - minHr) / (maxHr - minHr))
        : 'var(--accent-2)',
    }));
    // themeAttr forces the color scale to re-read tokens on theme change
  }, [strokes, themeAttr]); // eslint-disable-line react-hooks/exhaustive-deps

  if (points.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={185}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="stroke_rate"
          type="number"
          name="Rate"
          unit=" spm"
          tick={AXIS_TICK}
          axisLine={AXIS_LINE}
          tickLine={false}
          domain={['dataMin - 1', 'dataMax + 1']}
          tickFormatter={v => Math.round(v)}
        />
        <YAxis
          dataKey="pace_ms"
          type="number"
          name="Pace"
          reversed
          tick={AXIS_TICK}
          tickFormatter={v => formatPace(v)}
          axisLine={false}
          tickLine={false}
          width={58}
          domain={['dataMin - 1000', 'dataMax + 1000']}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          cursor={{ strokeDasharray: '3 3', stroke: 'var(--chart-ref)' }}
          formatter={(value, name) => {
            if (name === 'Pace') return [formatPace(value), 'Pace'];
            if (name === 'Rate') return [`${Number(value).toFixed(1)} spm`, 'Rate'];
            return [value, name];
          }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            return (
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-2) var(--space-3)',
                fontSize: '0.78rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--ink)',
              }}>
                <div>{formatPace(p.pace_ms)} @ {p.stroke_rate.toFixed(1)} spm</div>
                {p.heart_rate && <div style={{ color: 'var(--hr)' }}>{Math.round(p.heart_rate)} bpm</div>}
              </div>
            );
          }}
        />
        <Scatter data={points} isAnimationActive={false}>
          {points.map((p, i) => (
            <Cell key={i} fill={p.fill} fillOpacity={0.7} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
