import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import styles from './Stats.module.css';

export default function StatsRow() {
  const [summary, setSummary] = useState(null);
  const { formatPace, formatDistanceFull } = useUnits();

  useEffect(() => {
    api.getSummary().then(setSummary).catch(() => {});
  }, []);

  if (!summary) return null;

  const paceDelta = summary.avg_pace_30d && summary.avg_pace_prior_30d
    ? summary.avg_pace_prior_30d - summary.avg_pace_30d
    : null;

  return (
    <div className={styles.statsRow}>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>Season Metres</span>
        <span className={styles.statValue}>{formatDistanceFull(summary.season_meters)}</span>
      </div>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>This Week</span>
        <span className={styles.statValue}>{summary.sessions_this_week}</span>
      </div>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>Streak</span>
        <span className={styles.statValue}>{summary.current_streak}d</span>
      </div>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>30d Avg Pace</span>
        <span className={styles.statValue}>{formatPace(summary.avg_pace_30d)}</span>
        {paceDelta !== null && (
          <span className={`${styles.statDelta} ${paceDelta > 0 ? styles.deltaPositive : styles.deltaNegative}`}>
            {paceDelta > 0 ? '↓' : '↑'} {formatPace(Math.abs(paceDelta) + (summary.avg_pace_30d || 0))}
          </span>
        )}
      </div>
    </div>
  );
}
