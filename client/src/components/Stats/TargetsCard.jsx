import { useNavigate } from 'react-router-dom';
import { useUnits } from '../../context/UnitsContext.jsx';
import { distanceLabel } from '../PBBadge.jsx';
import chartStyles from '../Charts/Charts.module.css';
import ChartInfo from '../Charts/ChartInfo.jsx';
import styles from './Stats.module.css';

function deltaText(deltaMs) {
  if (deltaMs == null) return null;
  const seconds = Math.abs(deltaMs) / 1000;
  return `${deltaMs > 0 ? '+' : '-'}${seconds.toFixed(1)}s`;
}

function countdownText(days) {
  if (days == null) return null;
  if (days < 0) return 'race passed';
  if (days === 0) return 'race today';
  if (days === 1) return 'race tomorrow';
  return `${days} days to race`;
}

// Performance goals vs current PBs and race predictions. Expects the
// decorated goals from GET /api/goals; renders nothing when no performance
// target is set.
export default function TargetsCard({ goals }) {
  const { formatTime, formatPace } = useUnits();
  const navigate = useNavigate();

  const targets = (goals || []).filter(g => g.kind === 'performance' && g.active);
  if (targets.length === 0) return null;

  return (
    <div className={chartStyles.chartCard}>
      <div className={chartStyles.chartHeader}>
        <div className={chartStyles.chartTitle}>Targets</div>
      </div>
      <div className={styles.targetList}>
        {targets.map(goal => {
          const p = goal.progress || {};
          const countdown = countdownText(p.days_to_race);
          return (
            <div className={styles.targetRow} key={goal.id}>
              <div className={styles.targetName}>
                <span className={styles.targetDistance}>{distanceLabel(goal.distance)}</span>
                <span className={styles.targetLabel}>{goal.label || 'Target'}</span>
                {countdown && (
                  <span className={`${styles.targetChip} ${p.days_to_race >= 0 ? styles.targetChipAccent : ''}`}>
                    {countdown}
                  </span>
                )}
                {p.achieved && <span className={`${styles.targetChip} ${styles.targetChipPositive}`}>achieved</span>}
              </div>
              <div className={styles.targetStats}>
                <TargetStat label="Goal" value={formatTime(goal.target_time_ms)} sub={formatPace(p.target_pace_ms)} />
                <TargetStat
                  label="Current PB"
                  value={p.pb ? formatTime(p.pb.time_ms) : '--'}
                  sub={p.pb ? deltaText(p.pb_delta_ms) : 'no result yet'}
                  subTone={p.pb ? (p.pb_delta_ms <= 0 ? 'positive' : 'negative') : null}
                  onClick={p.pb ? () => navigate(`/session/${p.pb.workout_id}`) : null}
                />
                <TargetStat
                  label="Predicted"
                  value={p.prediction?.predicted_time != null ? formatTime(p.prediction.predicted_time) : '--'}
                  sub={p.prediction?.predicted_time != null ? deltaText(p.prediction_delta_ms) : 'not enough data'}
                  subTone={p.prediction?.predicted_time != null ? (p.prediction_delta_ms <= 0 ? 'positive' : 'negative') : null}
                />
              </div>
            </div>
          );
        })}
      </div>
      <ChartInfo>
        Each row compares a goal time against your current personal best and the trend-based
        race prediction for that distance. Deltas show how far off the target each mark is.
      </ChartInfo>
    </div>
  );
}

function TargetStat({ label, value, sub, subTone, onClick }) {
  const subClass = [
    styles.targetStatSub,
    subTone === 'positive' ? styles.deltaPositive : '',
    subTone === 'negative' ? styles.deltaNegative : '',
  ].join(' ');

  const body = (
    <>
      <span className={styles.targetStatLabel}>{label}</span>
      <span className={styles.targetStatValue}>{value}</span>
      {sub && <span className={subClass}>{sub}</span>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={`${styles.targetStat} ${styles.targetStatButton}`} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={styles.targetStat}>{body}</div>;
}
