import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import styles from './PaceRibbon.module.css';

function formatPaceLabel(paceMs) {
  const totalSeconds = paceMs / 1000;
  const mins = Math.floor(totalSeconds / 60);
  const secs = (totalSeconds % 60).toFixed(1).padStart(4, '0');
  return `${mins}:${secs} /500m`;
}

const MAX_TABLE_ROWS = 50;

function sampleStrokes(strokes, maxRows) {
  if (strokes.length <= maxRows) return strokes;
  const step = strokes.length / maxRows;
  return Array.from({ length: maxRows }, (_, i) => strokes[Math.floor(i * step)]);
}

// Canvas can't consume CSS variables, so resolve --accent at draw time and
// fade it toward a deep ember for slow strokes (t=0 fast, t=1 slow).
function parseHexColor(str) {
  const hex = str.trim().replace('#', '');
  if (hex.length !== 6) return null;
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}

function makeColorScale() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent');
  const accent = parseHexColor(raw) || [244, 71, 11];
  const [r1, g1, b1] = accent;
  const [r2, g2, b2] = accent.map(c => Math.round(c * 0.22));
  return (t) => {
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
  };
}

// Re-render when data-theme flips so the canvas re-reads token colors.
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

export default function PaceRibbon({ strokes, height = 48 }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [width, setWidth] = useState(0);
  const themeAttr = useThemeAttribute();

  const paces = useMemo(
    () => (strokes || []).map(s => s.pace_ms).filter(p => p > 0),
    [strokes]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (paces.length === 0 || !width) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const minPace = Math.min(...paces);
    const maxPace = Math.max(...paces);
    const range = maxPace - minPace || 1;

    const colWidth = Math.max(1, width / paces.length);
    const colorAt = makeColorScale();

    paces.forEach((pace, i) => {
      const t = (pace - minPace) / range;
      ctx.fillStyle = colorAt(t);
      ctx.fillRect(i * colWidth, 0, colWidth + 0.5, height);
    });

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    paces.forEach((pace, i) => {
      const x = i * colWidth + colWidth / 2;
      const y = height - ((pace - minPace) / range) * (height - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [paces, width, height, themeAttr]);

  const handleMouseMove = useCallback((e) => {
    if (paces.length === 0 || !width) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, e.clientX - rect.left));
    const colWidth = Math.max(1, width / paces.length);
    const idx = Math.min(paces.length - 1, Math.max(0, Math.floor(x / colWidth)));

    const pace = paces[idx];
    const minPace = Math.min(...paces);
    const maxPace = Math.max(...paces);
    const range = maxPace - minPace || 1;
    const pointX = idx * colWidth + colWidth / 2;
    const pointY = height - ((pace - minPace) / range) * (height - 8) - 4;

    setTooltip({ x: pointX, y: pointY, label: formatPaceLabel(pace) });
  }, [paces, width, height]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (!strokes || strokes.length === 0) return null;

  const canvasLabel = paces.length > 0
    ? `Pace ribbon: ${strokes.length} strokes, ranging from ${formatPaceLabel(Math.min(...paces))} to ${formatPaceLabel(Math.max(...paces))} per 500m`
    : `Pace ribbon: ${strokes.length} strokes`;
  const tableRows = sampleStrokes(strokes, MAX_TABLE_ROWS);

  return (
    <div className={styles.container} ref={containerRef}>
      {tooltip && (
        <>
          <div className={styles.crosshairLine} style={{ left: tooltip.x, height }} />
          <div className={styles.crosshairDot} style={{ left: tooltip.x, top: tooltip.y }} />
          <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
            {tooltip.label}
          </div>
        </>
      )}
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{ height }}
        role="img"
        aria-label={canvasLabel}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      <div className={styles.labels}>
        <span>Start</span>
        {paces.length > 0 && (
          <span className={styles.paceRange}>
            <span className={styles.paceFast}>▲ {formatPaceLabel(Math.min(...paces))}</span>
            {' · '}
            <span>▼ {formatPaceLabel(Math.max(...paces))}</span>
          </span>
        )}
        <span>Finish</span>
      </div>
      <table className="sr-only">
        <caption>Pace by stroke</caption>
        <thead>
          <tr>
            <th>Stroke</th>
            <th>Distance (m)</th>
            <th>Pace</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map((s, i) => (
            <tr key={s.stroke_number ?? i}>
              <td>{s.stroke_number ?? i + 1}</td>
              <td>{Math.round(s.distance_m)}</td>
              <td>{s.pace_ms > 0 ? formatPaceLabel(s.pace_ms) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
