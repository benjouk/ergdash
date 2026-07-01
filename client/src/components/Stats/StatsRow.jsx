import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import styles from './Stats.module.css';

export default function StatsRow({ summary: summaryProp, showMeters = true }) {
  const [fetched, setFetched] = useState(null);
  const { formatPace, formatDistanceFull } = useUnits();
  const { from, to } = useTimeRange();

  // When a parent (Dashboard) already holds the summary, reuse it instead of
  // fetching a second time.
  const external = summaryProp !== undefined;

  useEffect(() => {
    if (external) return;
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    api.getSummary(params).then(setFetched).catch(() => {});
  }, [from, to, external]);

  const summary = external ? summaryProp : fetched;
  if (!summary) return null;

  const metersLabel = summary.season_meters > 0 ? 'Season Metres' : 'Total Metres';
  const metersValue = summary.season_meters > 0 ? summary.season_meters : summary.total_meters;

  return (
    <div className={styles.statsRow}>
      {showMeters && (
        <div className={styles.statCell}>
          <span className={styles.statLabel}>{metersLabel}</span>
          <span className={styles.statValue}>{formatDistanceFull(metersValue)}</span>
        </div>
      )}
      <div className={styles.statCell}>
        <span className={styles.statLabel}>This Week</span>
        <span className={styles.statValue}>{summary.sessions_this_week}</span>
      </div>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>Streak</span>
        <span className={styles.statValue}>{summary.current_streak_weeks}w</span>
      </div>
      <div className={styles.statCell}>
        <span className={styles.statLabel}>Avg Pace</span>
        <span className={styles.statValue}>{formatPace(summary.avg_pace)}</span>
      </div>
    </div>
  );
}
