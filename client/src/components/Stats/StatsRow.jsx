import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import Sparkline from '../Feed/Sparkline.jsx';
import styles from './Stats.module.css';

function formatRelative(dateStr) {
  if (!dateStr) return null;
  const diffDays = (Date.now() - new Date(dateStr)) / 86400000;
  if (diffDays < 1) return 'today';
  if (diffDays < 2) return 'yesterday';
  return `${Math.floor(diffDays)}d ago`;
}

// Week-on-week volume change, as a delta chip. Down reads as caution (amber),
// up as progress (olive) - matching the app's semantic colour mapping.
function weekDeltaChip(summary) {
  const now = summary.weekly_meters;
  const prev = summary.prev_weekly_meters;
  if (!prev || prev <= 0 || now == null) return null;
  const change = (now - prev) / prev;
  const pct = Math.round(Math.abs(change) * 100);
  if (pct === 0) return { text: 'even', tone: 'neutral' };
  return {
    text: `${change > 0 ? '▲' : '▼'} ${pct}%`,
    tone: change >= 0 ? 'positive' : 'warn',
  };
}

export default function StatsRow({ summary: summaryProp, goals, showMeters = true }) {
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
  const seasonGoal = (goals || []).find(g =>
    g.kind === 'volume' && g.period === 'season' && g.active && g.progress);
  const goalPct = seasonGoal ? Math.round(seasonGoal.progress.percent) : null;
  const metersSub = inSeason
    ? seasonGoal
      ? `of ${formatDistance(seasonGoal.target_meters)} goal · ${summary.season_workouts} sessions`
      : `${summary.season_workouts} sessions · ${formatDistance(summary.total_meters)} lifetime`
    : `${summary.total_workouts} sessions`;

  const lastRow = formatRelative(summary.last_workout_date);
  const totalHours = Math.round(summary.total_time_ms / 3600000);
  const spark = summary.volume_sparkline;
  const sessions = summary.sessions_this_week || 0;

  return (
    <div className={styles.statsRow}>
      {showMeters && (
        <StatCell
          label={metersLabel}
          value={formatDistanceFull(metersValue)}
          chip={goalPct != null ? { text: `${goalPct}%`, tone: 'positive' } : null}
          sub={metersSub}
          viz={goalPct != null
            ? <ProgressBar pct={goalPct} />
            : <SparkViz data={spark} />}
        />
      )}
      <StatCell
        label="This Week"
        value={sessions}
        unit="sessions"
        chip={weekDeltaChip(summary)}
        sub={lastRow ? `last session ${lastRow}` : null}
        viz={<SegmentBar filled={sessions} total={7} />}
      />
      <StatCell
        label="Streak"
        value={`${summary.current_streak_weeks}w`}
        sub={`${summary.total_workouts} sessions all time`}
        viz={<SparkViz data={spark} />}
      />
      <StatCell
        label="Steady Pace"
        value={formatPace(summary.steady_pace)}
        sub={`${totalHours}h on the erg`}
        viz={<SparkViz data={spark} />}
      />
    </div>
  );
}

function StatCell({ label, value, unit, chip, sub, viz }) {
  return (
    <div className={styles.statCell}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValueRow}>
        <span className={styles.statValue}>{value}</span>
        {unit && <span className={styles.statUnit}>{unit}</span>}
      </span>
      {(chip || sub) && (
        <span className={styles.statMeta}>
          {chip && (
            <span className={`${styles.statChip} ${styles[`chip_${chip.tone}`]}`}>{chip.text}</span>
          )}
          {sub && <span className={styles.statSub}>{sub}</span>}
        </span>
      )}
      {viz && <span className={styles.statViz}>{viz}</span>}
    </div>
  );
}

function ProgressBar({ pct }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className={styles.progressTrack}>
      <span className={styles.progressFill} style={{ width: `${clamped}%` }} />
    </span>
  );
}

function SegmentBar({ filled, total }) {
  return (
    <span className={styles.segmentBar}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`${styles.segment} ${i < filled ? styles.segmentOn : ''}`}
        />
      ))}
    </span>
  );
}

function SparkViz({ data }) {
  if (!data || data.filter(v => v > 0).length < 2) return <span className={styles.vizSpacer} />;
  return (
    <Sparkline data={data} color="var(--ink-3)" width={120} height={22} strokeWidth={1.4} />
  );
}
