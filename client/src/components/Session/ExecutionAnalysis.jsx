import ChartInfo from '../Charts/ChartInfo.jsx';
import styles from './ExecutionAnalysis.module.css';

// Renders the phase table (continuous pieces) and interval rep-consistency
// summary from the versioned analysis. The categorical execution labels live in
// SessionAnalysis (the derived-analysis block); this covers the tabular detail.
// `cardStyles` is the Session CSS module (card/table chrome).
export default function ExecutionAnalysis({ analysis, formatPace, cardStyles }) {
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
                  <th>Pace</th>
                  <th className={cardStyles.hideNarrow}>Rate</th>
                  <th className={cardStyles.hideNarrow}>Power</th>
                  <th className={cardStyles.hideNarrow}>HR</th>
                </tr>
              </thead>
              <tbody>
                {phases.map(phase => (
                  <tr key={phase.name}>
                    <td style={{ textTransform: 'capitalize' }}>{phase.name}</td>
                    <td>{phase.avg_pace_ms ? formatPace(phase.avg_pace_ms) : '--'}</td>
                    <td className={cardStyles.hideNarrow}>{phase.avg_rate ?? '--'}</td>
                    <td className={cardStyles.hideNarrow}>{phase.avg_power ? `${phase.avg_power}W` : '--'}</td>
                    <td className={cardStyles.hideNarrow}>{phase.avg_hr ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ChartInfo>The piece split into start, settle, middle, pressure and finish phases — average pace, rate, power and HR in each. It describes shape, not intensity.</ChartInfo>
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
