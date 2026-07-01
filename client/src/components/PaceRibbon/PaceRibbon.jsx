import { useRef, useEffect, useState, useCallback } from 'react';
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

function interpolateColor(t) {
  const r1 = 0, g1 = 232, b1 = 152;
  const r2 = 22, g2 = 50, b2 = 38;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

export default function PaceRibbon({ strokes, height = 48 }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!strokes || strokes.length === 0 || !width) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const paces = strokes.map(s => s.pace_ms).filter(p => p > 0);
    if (paces.length === 0) return;

    const minPace = Math.min(...paces);
    const maxPace = Math.max(...paces);
    const range = maxPace - minPace || 1;

    const colWidth = Math.max(1, width / paces.length);

    paces.forEach((pace, i) => {
      const t = (pace - minPace) / range;
      ctx.fillStyle = interpolateColor(t);
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
  }, [strokes, width, height]);

  const handleMouseMove = useCallback((e) => {
    if (!strokes || strokes.length === 0 || !width) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.floor((x / width) * strokes.length);
    if (idx >= 0 && idx < strokes.length) {
      const s = strokes[idx];
      const paceMs = s.pace_ms;
      const totalSeconds = paceMs / 1000;
      const mins = Math.floor(totalSeconds / 60);
      const secs = (totalSeconds % 60).toFixed(1).padStart(4, '0');
      setTooltip({ x, label: `${mins}:${secs} /500m` });
    }
  }, [strokes, width]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (!strokes || strokes.length === 0) return null;

  const paces = strokes.map(s => s.pace_ms).filter(p => p > 0);
  const canvasLabel = paces.length > 0
    ? `Pace ribbon: ${strokes.length} strokes, ranging from ${formatPaceLabel(Math.min(...paces))} to ${formatPaceLabel(Math.max(...paces))} per 500m`
    : `Pace ribbon: ${strokes.length} strokes`;
  const tableRows = sampleStrokes(strokes, MAX_TABLE_ROWS);

  return (
    <div className={styles.container} ref={containerRef}>
      {tooltip && (
        <div className={styles.tooltip} style={{ left: tooltip.x }}>
          {tooltip.label}
        </div>
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
