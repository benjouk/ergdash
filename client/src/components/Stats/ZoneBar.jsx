import { useCallback, useRef, useState } from 'react';
import { ZONES } from '../../styles/chartTheme.js';
import styles from './ZoneBar.module.css';

const ZONE_NAMES = ['Recovery', 'Endurance', 'Moderate', 'Threshold', 'Max'];

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Proportional five-segment strip of a session's time in each HR zone.
export default function ZoneBar({ zoneTimes }) {
  const barRef = useRef(null);
  const [hover, setHover] = useState(null);

  const total = zoneTimes?.length ? zoneTimes.reduce((s, z) => s + z.time_s, 0) : 0;

  const handleMouseMove = useCallback((e) => {
    if (!zoneTimes?.length || total <= 0 || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = x / rect.width;

    let cumulative = 0;
    let index = zoneTimes.length - 1;
    for (let i = 0; i < zoneTimes.length; i += 1) {
      cumulative += zoneTimes[i].time_s / total;
      if (pct <= cumulative) {
        index = i;
        break;
      }
    }

    setHover({ index, x });
  }, [zoneTimes, total]);

  const handleMouseLeave = useCallback(() => setHover(null), []);

  if (!zoneTimes?.length || total <= 0) return null;

  const estimatedFromAvg = zoneTimes.every(z => z.source === 'avg_hr');
  const hoveredZone = hover ? zoneTimes[hover.index] : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.barWrap}>
        {hover && hoveredZone && (
          <>
            <div className={styles.crosshairLine} style={{ left: hover.x }} />
            <div
              className={styles.tooltip}
              style={{ left: hover.x }}
            >
              <span
                className={styles.tooltipSwatch}
                style={{ background: ZONES[hoveredZone.zone - 1] }}
              />
              Z{hoveredZone.zone} {ZONE_NAMES[hoveredZone.zone - 1]} · {formatDuration(hoveredZone.time_s)} · {Math.round((hoveredZone.time_s / total) * 100)}%
            </div>
          </>
        )}
        <div
          ref={barRef}
          className={styles.bar}
          role="img"
          aria-label={`Time in HR zones: ${zoneTimes.map(z => `zone ${z.zone} ${formatDuration(z.time_s)}`).join(', ')}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {zoneTimes.map((z, i) => (
            <div
              key={z.zone}
              className={`${styles.segment} ${hover && hover.index !== i ? styles.segmentDimmed : ''}`}
              style={{
                width: `${(z.time_s / total) * 100}%`,
                background: ZONES[z.zone - 1],
              }}
            />
          ))}
        </div>
      </div>
      <div className={styles.legend}>
        {zoneTimes.map((z, i) => (
          <span
            key={z.zone}
            className={`${styles.legendItem} ${hover?.index === i ? styles.legendItemActive : ''}`}
          >
            <span className={styles.swatch} style={{ background: ZONES[z.zone - 1] }} />
            <span className={styles.zoneName}>Z{z.zone} {ZONE_NAMES[z.zone - 1]}</span>
            <span className={styles.legendValue}>{formatDuration(z.time_s)}</span>
            <span className={styles.legendPct}>{Math.round((z.time_s / total) * 100)}%</span>
          </span>
        ))}
        {estimatedFromAvg && (
          <span className={styles.estimatedNote} title="Derived from session average HR">
            estimated from avg HR
          </span>
        )}
      </div>
    </div>
  );
}
