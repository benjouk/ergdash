import { useState, useEffect } from 'react';
import { CalendarDays, Flame, Timer, Waves } from 'lucide-react';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import styles from './Stats.module.css';

function formatRelative(dateStr) {
  if (!dateStr) return null;
  const diffDays = (Date.now() - new Date(dateStr)) / 86400000;
  if (diffDays < 1) return 'today';
  if (diffDays < 2) return 'yesterday';
  return `${Math.floor(diffDays)}d ago`;
}

export default function StatsRow({ summary: summaryProp, showMeters = true }) {
  const [fetched, setFetched] = useState(null);
  const { formatPace, formatDistance, formatDistanceFull } = useUnits();
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

  const inSeason = summary.season_meters > 0;
  const metersLabel = inSeason ? 'Season Metres' : 'Total Metres';
  const metersValue = inSeason ? summary.season_meters : summary.total_meters;
  const metersSub = inSeason
    ? `${summary.season_workouts} sessions · ${formatDistance(summary.total_meters)} lifetime`
    : `${summary.total_workouts} sessions`;

  const lastRow = formatRelative(summary.last_workout_date);
  const totalHours = Math.round(summary.total_time_ms / 3600000);

  return (
    <div className={styles.statsRow}>
      {showMeters && (
        <StatCell
          icon={Waves}
          label={metersLabel}
          value={formatDistanceFull(metersValue)}
          sub={metersSub}
          lead
        />
      )}
      <StatCell
        icon={CalendarDays}
        label="This Week"
        value={summary.sessions_this_week}
        sub={lastRow ? `last session ${lastRow}` : null}
      />
      <StatCell
        icon={Flame}
        label="Streak"
        value={`${summary.current_streak_weeks}w`}
        sub={`${summary.total_workouts} sessions all time`}
      />
      <StatCell
        icon={Timer}
        label="Avg Pace"
        value={formatPace(summary.avg_pace)}
        sub={`${totalHours}h on the erg`}
      />
    </div>
  );
}

function StatCell({ icon: Icon, label, value, sub, lead = false }) {
  return (
    <div className={`${styles.statCell} ${lead ? styles.statCellLead : ''}`}>
      <span className={styles.statIcon}>
        <Icon size={15} aria-hidden="true" />
      </span>
      <span className={styles.statBody}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statValue}>{value}</span>
        {sub && <span className={styles.statSub}>{sub}</span>}
      </span>
    </div>
  );
}
