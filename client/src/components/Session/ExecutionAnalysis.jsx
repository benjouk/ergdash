import { useEffect, useId, useState } from 'react';
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
// and a degradation summary for interval sets. Tapping a chip reveals its `basis`
// (why that label was chosen) as a disclosure line below the row — a full-width,
// mobile-safe alternative to a floating tooltip. `cardStyles` is the Session CSS
// module (card/table chrome); the cards still use ChartInfo's corner popover.
export default function ExecutionAnalysis({ analysis, formatPace, cardStyles }) {
  const [openKind, setOpenKind] = useState(null);
  const explainId = useId();

  // Close the open explanation on Escape.
  useEffect(() => {
    if (!openKind) return undefined;
    const onKeyDown = e => { if (e.key === 'Escape') setOpenKind(null); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openKind]);

  if (!analysis?.execution) return null;

  const { execution, phases, intervals } = analysis;
  const chips = CHIP_ORDER
    .map(kind => ({ kind, metric: execution[kind] }))
    .filter(({ kind, metric }) => showsExecution(metric) && execLabel(kind, metric.value));

  const hasPhases = Array.isArray(phases) && phases.length > 0;
  const openChip = chips.find(c => c.kind === openKind && c.metric.basis);

  return (
    <>
      {chips.length > 0 && (
        <div className={styles.execution}>
          <div className={styles.chips} aria-label="Observed execution">
            {chips.map(({ kind, metric }) => {
              const open = openKind === kind;
              return (
                <button
                  type="button"
                  key={kind}
                  className={`${styles.chip} ${open ? styles.chipOpen : ''}`}
                  aria-expanded={open}
                  aria-controls={metric.basis ? explainId : undefined}
                  onClick={() => setOpenKind(k => (k === kind ? null : kind))}
                >
                  <span className={styles.chipLabel}>{CHIP_LABELS[kind]}</span>
                  <span className={styles.chipValue}>{execLabel(kind, metric.value)}</span>
                  {metric.basis && <span className={styles.chipHint} aria-hidden="true">?</span>}
                </button>
              );
            })}
          </div>
          {openChip && (
            <p id={explainId} role="note" aria-live="polite" className={styles.explain}>
              {openChip.metric.basis}
            </p>
          )}
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
