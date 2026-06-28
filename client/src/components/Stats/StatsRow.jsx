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

  const paceDelta = summary.avg_pace && summary.avg_pace_prior
    ? summary.avg_pace_prior - summary.avg_pace
    : null;

  const metersLabel = summary.season_meters > 0 ? 'Season Metres' : 'Total Metres';
  const metersValue = summary.season_meters > 0 ? summary.season_meters : summary.total_meters;

  return (
    <div className={styles.statsRow}>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>{metersLabel}</span>
        <span className={styles.statValue}>{formatDistanceFull(metersValue)}</span>
      </div>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>This Week</span>
        <span className={styles.statValue}>{summary.sessions_this_week}</span>
      </div>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>Streak</span>
        <span className={styles.statValue}>{summary.current_streak_weeks}w</span>
      </div>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>{summary.avg_pace_label || 'Avg Pace'}</span>
        <span className={styles.statValue}>{formatPace(summary.avg_pace)}</span>
        {paceDelta !== null && (
          <span className={`${styles.statDelta} ${paceDelta > 0 ? styles.deltaPositive : styles.deltaNegative}`}>
            {paceDelta > 0 ? '↓' : '↑'} {formatPace(Math.abs(paceDelta) + (summary.avg_pace || 0))}
          </span>
        )}
      </div>
    </div>
  );
}
