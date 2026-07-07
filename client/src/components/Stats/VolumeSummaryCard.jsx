import { useMemo } from 'react';
import { useUnits } from '../../context/UnitsContext.jsx';
import chartStyles from '../Charts/Charts.module.css';
import ChartInfo from '../Charts/ChartInfo.jsx';
import styles from './Stats.module.css';

function AreaSparkline({ data, width = 260, height = 44 }) {
  const path = useMemo(() => {
    const values = (data || []).filter(v => v >= 0);
    if (values.length < 2) return null;

    const max = Math.max(...values, 1);
    const step = width / (values.length - 1);
    const points = values.map((v, i) => [i * step, height - (v / max) * (height - 6) - 3]);

    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [data, width, height]);

  if (!path) return null;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={styles.volumeSpark}>
      <path d={path.area} fill="var(--accent-bg)" stroke="none" />
      <path d={path.line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function deltaLabel(current, previous) {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: 'flat', positive: null };
  return { text: `${pct > 0 ? '+' : ''}${pct}% vs prior`, positive: pct > 0 };
}

const PERIOD_LABELS = {
  weekly: 'This week',
  monthly: 'This month',
  season: 'Season',
  year: 'This year',
};

function GoalBars({ goals }) {
  const { formatDistance } = useUnits();
  const volumeGoals = (goals || []).filter(g => g.kind === 'volume' && g.active && g.progress);
  if (volumeGoals.length === 0) return null;

  return (
    <div className={styles.goalBars}>
      {volumeGoals.map(goal => {
        const p = goal.progress;
        const pct = Math.min(100, p.percent);
        return (
          <div className={styles.goalBar} key={goal.id}>
            <div className={styles.goalBarMeta}>
              <span className={styles.goalBarPeriod}>{PERIOD_LABELS[goal.period] || goal.period}</span>
              <span>
                {formatDistance(p.meters)} of {formatDistance(p.target_meters)}
                {p.on_pace ? '' : ' · behind pace'}
              </span>
            </div>
            <div className={styles.goalBarTrack}>
              <div
                className={`${styles.goalBarFill} ${p.on_pace ? '' : styles.goalBarBehind}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function VolumeSummaryCard({ summary, goals }) {
  const { formatDistance } = useUnits();
  if (!summary) return null;

  const weekDelta = deltaLabel(summary.weekly_meters, summary.prev_weekly_meters);
  const monthDelta = deltaLabel(summary.monthly_meters, summary.prev_monthly_meters);

  return (
    <div className={chartStyles.chartCard}>
      <div className={chartStyles.chartHeader}>
        <div className={chartStyles.chartTitle}>
          Volume
        </div>
      </div>
      <div className={styles.volumeStats}>
        <MiniStat label="Last 7 Days" value={formatDistance(summary.weekly_meters)} delta={weekDelta} />
        <MiniStat label="Prior 7 Days" value={formatDistance(summary.prev_weekly_meters)} />
        <MiniStat label="Last 30 Days" value={formatDistance(summary.monthly_meters)} delta={monthDelta} />
      </div>
      <AreaSparkline data={summary.volume_sparkline} />
      <GoalBars goals={goals} />
      <ChartInfo>Distance totals for rolling 7- and 30-day windows, with the change versus the windows before them. The shaded area sketches recent weekly volume. Progress bars track any volume goals set in Settings against their calendar window.</ChartInfo>
    </div>
  );
}

function MiniStat({ label, value, delta }) {
  return (
    <div className={styles.miniStat}>
      <span className={styles.miniStatLabel}>{label}</span>
      <span className={styles.miniStatValue}>{value}</span>
      {delta && (
        <span className={`${styles.miniStatDelta} ${delta.positive === true ? styles.deltaPositive : ''} ${delta.positive === false ? styles.deltaNegative : ''}`}>
          {delta.text}
        </span>
      )}
    </div>
  );
}
