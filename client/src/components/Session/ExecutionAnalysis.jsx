import ChartInfo from '../Charts/ChartInfo.jsx';
import styles from './ExecutionAnalysis.module.css';

// Renders the phase table (continuous pieces) and interval rep-consistency
// summary from the versioned analysis. The categorical execution labels live in
// SessionAnalysis (the derived-analysis block); this covers the tabular detail.
// `cardStyles` is the Session CSS module (card/table chrome).
export default function ExecutionAnalysis({ analysis, workout, formatPace, formatTime, cardStyles }) {
  if (!analysis?.execution) return null;

  const { phases, intervals } = analysis;
  const hasPhases = Array.isArray(phases) && phases.length > 0;

  return (
    <>
      {hasPhases && (
        <div className={cardStyles.card}>
          <div className={cardStyles.cardHeader}>
            <div className={cardStyles.cardTitle}>Phases</div>
          </div>
          <div className={cardStyles.tableWrap}>
            <table className={cardStyles.splitsTable}>
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Range</th>
                  <th>Pace</th>
                  <th className={cardStyles.hideNarrow}>Rate</th>
                  <th className={cardStyles.hideNarrow}>Power</th>
                  <th className={cardStyles.hideNarrow}>HR</th>
                </tr>
              </thead>
              <tbody>
                {phases.map(phase => (
                  <tr key={phase.name}>
                    <td>{phaseName(phase.name)}</td>
                    <td>{phaseRange(phase, workout, formatTime)}</td>
                    <td>{phase.avg_pace_ms ? formatPace(phase.avg_pace_ms) : '--'}</td>
                    <td className={cardStyles.hideNarrow}>{phase.avg_rate ?? '--'}</td>
                    <td className={cardStyles.hideNarrow}>{phase.avg_power ? `${phase.avg_power}W` : '--'}</td>
                    <td className={cardStyles.hideNarrow}>{phase.avg_hr ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ChartInfo>The piece split into start, settle, middle, late and finish phases, with the range and average pace, rate, power and HR in each. It describes shape, not intensity.</ChartInfo>
        </div>
      )}

      {intervals && (
        <div className={cardStyles.card}>
          <div className={cardStyles.cardHeader}>
            <div className={cardStyles.cardTitle}>Rep consistency</div>
            <span className={cardStyles.cardKicker}>{intervals.rep_count} reps</span>
          </div>
          <div className={styles.intervalSummary}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Spread</span>
              <span className={styles.statValue}>{intervals.spread_percent}%</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Rep-to-rep</span>
              <span className={styles.statValue}>
                {intervals.degradation_percent > 0 ? '+' : ''}{intervals.degradation_percent}%
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Consistency</span>
              <span className={styles.statValue}>{intervals.consistency}</span>
            </div>
            {intervals.fastest_pace_ms > 0 && (
              <div className={styles.stat}>
                <span className={styles.statLabel}>Fastest</span>
                <span className={styles.statValue}>
                  {formatPace(intervals.fastest_pace_ms)}
                  <span className={styles.statRep}> R{intervals.fastest_rep_index + 1}</span>
                </span>
              </div>
            )}
            {intervals.slowest_pace_ms > 0 && (
              <div className={styles.stat}>
                <span className={styles.statLabel}>Slowest</span>
                <span className={styles.statValue}>
                  {formatPace(intervals.slowest_pace_ms)}
                  <span className={styles.statRep}> R{intervals.slowest_rep_index + 1}</span>
                </span>
              </div>
            )}
            {intervals.first_rep_fast && (
              <div className={styles.stat}>
                <span className={styles.statLabel}>Note</span>
                <span className={styles.statValue}>Went out hard</span>
              </div>
            )}
          </div>
          <ChartInfo>{intervals.basis} Rep-to-rep is the last rep vs the first; positive means you slowed across the set.</ChartInfo>
        </div>
      )}
    </>
  );
}

function phaseName(name) {
  const normalized = name === 'pressure' ? 'late' : name;
  if (!normalized) return '--';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).replaceAll('_', ' ');
}

function phaseRange(phase, workout, formatTime) {
  // Prefer the absolute range the server sliced with (analysis v6+); the
  // percentage fallback covers older cached analyses.
  if (Number.isFinite(Number(phase?.start_m)) && Number.isFinite(Number(phase?.end_m))) {
    return `${Number(phase.start_m).toLocaleString()}–${Number(phase.end_m).toLocaleString()}m`;
  }
  if (Number.isFinite(Number(phase?.start_s)) && Number.isFinite(Number(phase?.end_s))) {
    return `${formatRangeTime(Number(phase.start_s) * 1000, formatTime)}–${formatRangeTime(Number(phase.end_s) * 1000, formatTime)}`;
  }

  const startPct = Number(phase?.start_pct);
  const endPct = Number(phase?.end_pct);
  if (!Number.isFinite(startPct) || !Number.isFinite(endPct)) return '--';

  const byTime = /FixedTime/i.test(workout?.workout_type || '');
  if (byTime && Number(workout?.time_ms) > 0) {
    const total = Number(workout.time_ms);
    return `${formatRangeTime((startPct / 100) * total, formatTime)}–${formatRangeTime((endPct / 100) * total, formatTime)}`;
  }

  if (Number(workout?.distance) > 0) {
    const total = Number(workout.distance);
    const start = Math.round((startPct / 100) * total);
    const end = Math.round((endPct / 100) * total);
    return `${start.toLocaleString()}–${end.toLocaleString()}m`;
  }

  return `${startPct}–${endPct}%`;
}

function formatRangeTime(value, formatTime) {
  const milliseconds = Math.round(Number(value));
  if (milliseconds === 0) return '0:00';
  if (formatTime) return formatTime(milliseconds);
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
