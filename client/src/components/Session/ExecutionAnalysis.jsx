import ChartInfo from '../Charts/ChartInfo.jsx';
import { execLabel, showsExecution } from '../../utils/executionLabels.js';
import styles from './ExecutionAnalysis.module.css';

// Chip labels for each execution channel.
const CHIP_LABELS = {
  intensity: 'Observed effort',
  pacing: 'Pacing',
  finish: 'Finish',
  rate: 'Rate',
  stroke_effectiveness: 'Work/stroke',
};

const CHIP_ORDER = ['intensity', 'pacing', 'finish', 'rate', 'stroke_effectiveness'];

// Renders the versioned observed-execution analysis: a chip row (only the
// channels confident enough to state), a per-phase table for continuous pieces,
// and a degradation summary for interval sets. Every value's own `basis` string
// is surfaced through the existing ChartInfo popover, so no separate metric
// dictionary is needed. `cardStyles` is the Session CSS module (card/table chrome).
export default function ExecutionAnalysis({ analysis, formatPace, cardStyles }) {
  if (!analysis?.execution) return null;

  const { execution, phases, intervals } = analysis;
  const chips = CHIP_ORDER
    .map(kind => ({ kind, metric: execution[kind] }))
    .filter(({ kind, metric }) => showsExecution(metric) && execLabel(kind, metric.value));

  const hasPhases = Array.isArray(phases) && phases.length > 0;

  return (
    <>
      {chips.length > 0 && (
        <div className={styles.chips} aria-label="Observed execution">
          {chips.map(({ kind, metric }) => (
            <span key={kind} className={styles.chip}>
              <span className={styles.chipLabel}>{CHIP_LABELS[kind]}</span>
              <span className={styles.chipValue}>{execLabel(kind, metric.value)}</span>
              {metric.basis && <ChartInfo>{metric.basis}</ChartInfo>}
            </span>
          ))}
        </div>
      )}

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
