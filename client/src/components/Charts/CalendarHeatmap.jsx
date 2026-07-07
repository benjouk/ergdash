import { useState, useEffect, useMemo, useCallback } from 'react';
import { scaleQuantize } from 'd3-scale';
import { api } from '../../api.js';
import { usePrefs } from '../../context/PrefsContext.jsx';
import styles from './Charts.module.css';
import ChartInfo from './ChartInfo.jsx';

const CELL = 11;
const GAP = 2;
const WEEKS = 53;
const DAY_LABELS = {
  monday: ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'],
  sunday: ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'],
};
const LEFT_PAD = 28;
const TOP_PAD = 16;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function gridStart(today, weekStart) {
  const start = new Date(today);
  const dow = weekStart === 'sunday' ? start.getDay() : (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dow - (WEEKS - 1) * 7);
  return start;
}

export default function CalendarHeatmap() {
  const [days, setDays] = useState(null);
  const [plans, setPlans] = useState([]);
  const { weekStart } = usePrefs();

  useEffect(() => {
    const today = new Date();
    const from = isoDate(gridStart(today, weekStart));
    api.getCalendar({ from })
      .then(d => setDays(d.days || []))
      .catch(() => setDays([]));
    api.getPlans({ from })
      .then(d => setPlans(d.plans || []))
      .catch(() => setPlans([]));
  }, [weekStart]);

  const grid = useMemo(() => {
    if (!days) return null;
    const byDate = new Map(days.map(d => [d.date, d]));
    // Per-day plan outcome for the adherence ring: a missed plan trumps a
    // completed one so slipped days stay visible.
    const planByDate = new Map();
    for (const p of plans) {
      if (p.adherence !== 'completed' && p.adherence !== 'missed') continue;
      const current = planByDate.get(p.date);
      if (current !== 'missed') {
        planByDate.set(p.date, p.adherence === 'missed' ? 'missed' : 'completed');
      }
    }
    const today = new Date();
    const start = gridStart(today, weekStart);
    const max = Math.max(0, ...days.map(d => d.meters));
    const opacity = scaleQuantize()
      .domain([1, Math.max(max, 1)])
      .range([0.25, 0.45, 0.65, 0.85, 1]);

    const cells = [];
    const monthLabels = [];
    let lastMonth = -1;
    const cursor = new Date(start);
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        if (cursor > today) break;
        const date = isoDate(cursor);
        const entry = byDate.get(date);
        cells.push({
          x: LEFT_PAD + w * (CELL + GAP),
          y: TOP_PAD + d * (CELL + GAP),
          date,
          meters: entry?.meters || 0,
          sessions: entry?.sessions || 0,
          opacity: entry?.meters ? opacity(entry.meters) : 0,
          plan: planByDate.get(date) || null,
        });
        if (d === 0 && cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth();
          monthLabels.push({
            x: LEFT_PAD + w * (CELL + GAP),
            label: cursor.toLocaleDateString('en-GB', { month: 'short' }),
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const total = days.reduce((s, d) => s + d.meters, 0);
    return { cells, monthLabels, total };
  }, [days, plans, weekStart]);

  const scrollRef = useCallback((node) => {
    if (node) node.scrollLeft = node.scrollWidth;
  }, []);

  if (!grid || grid.cells.length === 0) return null;

  const width = LEFT_PAD + WEEKS * (CELL + GAP);
  const height = TOP_PAD + 7 * (CELL + GAP);

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Training Calendar
        </div>
        <div className={styles.chartValue}>
          {(grid.total / 1000).toFixed(0)}k
          <span className={styles.chartValueUnit}>last 12 months</span>
        </div>
      </div>
      <div ref={scrollRef} style={{ overflowX: 'auto' }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Calendar heatmap of daily meters over the last 12 months"
        >
          {grid.monthLabels.map(m => (
            <text
              key={`${m.label}-${m.x}`}
              x={m.x}
              y={10}
              style={{ fontSize: 9, fill: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}
            >
              {m.label}
            </text>
          ))}
          {DAY_LABELS[weekStart].map((label, i) => label && (
            <text
              key={label}
              x={0}
              y={TOP_PAD + i * (CELL + GAP) + CELL - 2}
              style={{ fontSize: 9, fill: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}
            >
              {label}
            </text>
          ))}
          {grid.cells.map(cell => (
            <rect
              key={cell.date}
              x={cell.x}
              y={cell.y}
              width={CELL}
              height={CELL}
              rx={2}
              fill={cell.meters ? 'var(--chart-1)' : 'var(--rule)'}
              fillOpacity={cell.meters ? cell.opacity : 0.5}
              stroke={cell.plan === 'missed' ? 'var(--negative)' : cell.plan === 'completed' ? 'var(--positive)' : 'none'}
              strokeWidth={cell.plan ? 1.5 : 0}
            >
              <title>
                {(cell.meters
                  ? `${cell.date}: ${cell.meters.toLocaleString()}m (${cell.sessions} session${cell.sessions === 1 ? '' : 's'})`
                  : `${cell.date}: rest`)
                  + (cell.plan ? ` · plan ${cell.plan}` : '')}
              </title>
            </rect>
          ))}
        </svg>
      </div>
    
      <ChartInfo>A year of training at a glance: each cell is one day, shaded by metres rowed. Darker cells were bigger days. Ringed cells had a planned session — green when completed as planned, red when missed.</ChartInfo>
    </div>
  );
}
