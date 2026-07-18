import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { distanceLabel } from '../PBBadge.jsx';
import chartStyles from '../Charts/Charts.module.css';
import ChartInfo from '../Charts/ChartInfo.jsx';
import styles from './Stats.module.css';

const DAY_MS = 86400000;

const VERDICT_META = {
  achieved: { label: 'goal achieved', className: styles.raceVerdictOnTrack },
  on_track: { label: 'on track', className: styles.raceVerdictOnTrack },
  close: { label: 'close', className: styles.raceVerdictClose },
  at_risk: { label: 'at risk', className: styles.raceVerdictAtRisk },
  insufficient_data: { label: 'no trend yet', className: '' },
};

const PHASE_CLASSES = {
  base: styles.racePhaseBase,
  sharpen: styles.racePhaseSharpen,
  taper: styles.racePhaseTaper,
};

function shortDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

// Works backwards from the race date of an active performance target:
// training phases, countdown milestones, and whether the current result trend
// actually lands on the goal time. Defaults to the nearest upcoming race;
// with several race-dated targets a chip row switches between them.
export default function RacePlanCard({ goals }) {
  const { formatTime } = useUnits();
  const [plan, setPlan] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const raceGoals = (goals || [])
    .filter(g => g.kind === 'performance' && g.active && g.race_date && (g.progress?.days_to_race ?? -1) >= 0)
    .sort((a, b) => a.progress.days_to_race - b.progress.days_to_race);

  const goal = raceGoals.find(g => g.id === selectedId) || raceGoals[0] || null;
  const goalId = goal?.id ?? null;

  useEffect(() => {
    if (goalId == null) {
      setPlan(null);
      return;
    }
    let mounted = true;
    api.getRacePlan(goalId)
      .then(data => { if (mounted) setPlan(data); })
      .catch(() => { if (mounted) setPlan(null); });
    return () => { mounted = false; };
  }, [goalId]);

  if (!goal || !plan || plan.goal_id !== goalId || plan.days_to_race < 0) return null;

  const verdict = VERDICT_META[plan.trajectory.verdict] || VERDICT_META.insufficient_data;
  const startMs = Date.parse(`${plan.timeline_start}T00:00:00Z`);
  const raceMs = Date.parse(`${plan.race_date}T00:00:00Z`);
  const totalDays = Math.max(1, (raceMs - startMs) / DAY_MS);
  const todayFraction = Math.min(1, Math.max(0, (Date.parse(`${todayIso()}T00:00:00Z`) - startMs) / DAY_MS / totalDays));
  const nextMilestone = plan.milestones.find(m => !m.passed);

  return (
    <div className={chartStyles.chartCard}>
      <div className={chartStyles.chartHeader}>
        <div className={chartStyles.chartTitle}>Race Plan</div>
        <div className={styles.racePlanMeta}>
          {raceGoals.length > 1 ? (
            raceGoals.map(g => (
              <button
                key={g.id}
                type="button"
                className={`${styles.raceGoalButton} ${g.id === goalId ? styles.raceGoalButtonActive : ''}`}
                onClick={() => setSelectedId(g.id)}
              >
                {distanceLabel(g.distance)} · {g.progress.days_to_race}d
              </button>
            ))
          ) : (
            <span className={styles.targetDistance}>{distanceLabel(plan.distance)}</span>
          )}
          <span className={`${styles.targetChip} ${styles.targetChipAccent}`}>
            {plan.days_to_race === 0 ? 'race today' : `${plan.days_to_race} days to race`}
          </span>
          {verdict.label && (
            <span className={`${styles.targetChip} ${verdict.className}`}>{verdict.label}</span>
          )}
        </div>
      </div>

      <p className={styles.raceSummary}>{summaryText(plan, formatTime)}</p>

      <div className={styles.raceTimeline}>
        {plan.phases.map(phase => {
          const from = Date.parse(`${phase.from}T00:00:00Z`);
          const to = Date.parse(`${phase.to}T00:00:00Z`) + DAY_MS;
          const width = `${(((to - from) / DAY_MS) / totalDays) * 100}%`;
          const isCurrent = plan.current_phase === phase.key;
          return (
            <div
              key={phase.key}
              className={`${styles.racePhase} ${PHASE_CLASSES[phase.key] || ''} ${isCurrent ? styles.racePhaseCurrent : ''}`}
              style={{ width }}
              title={`${phase.label}: ${phase.description}`}
            >
              <span>{phase.label}</span>
            </div>
          );
        })}
        <div className={styles.raceTodayMarker} style={{ left: `${todayFraction * 100}%` }} aria-hidden="true" />
      </div>
      <div className={styles.raceScale}>
        <span>{shortDate(plan.timeline_start)}</span>
        <span>{shortDate(plan.race_date)}</span>
      </div>

      <ul className={styles.raceMilestones}>
        {plan.milestones.map(m => (
          <li
            key={m.key}
            className={`${styles.raceMilestone} ${m.passed ? styles.raceMilestonePassed : ''} ${m === nextMilestone ? styles.raceMilestoneNext : ''}`}
          >
            <span className={styles.raceMilestoneDate}>{shortDate(m.date)}</span>
            <span>
              <span className={styles.raceMilestoneLabel}>{m.label}</span>
              <span className={styles.raceMilestoneDesc}> {m.description}</span>
            </span>
          </li>
        ))}
      </ul>

      <ChartInfo>
        Phases and milestones count back from race day: a base block, a month of
        sharpening, then a week-long taper. The projection extends the trend of
        your recent results at this distance to race day and compares it with the
        goal time - it is an estimate, and it sharpens as you log more tests.
      </ChartInfo>
    </div>
  );
}

function summaryText(plan, formatTime) {
  const t = plan.trajectory;
  const goalTime = formatTime(plan.target_time_ms);

  if (t.verdict === 'achieved') {
    return `Your PB already beats the ${goalTime} goal - the job on race day is to repeat it.`;
  }
  if (t.verdict === 'insufficient_data') {
    return `Not enough recent ${distanceLabel(plan.distance)} results to project race day - row a test piece to start the trend.`;
  }

  const projected = formatTime(t.projected_time_ms);
  const deltaS = Math.abs(t.projected_delta_ms) / 1000;
  if (t.verdict === 'on_track') {
    return `Current trend lands at ${projected} on race day - inside the ${goalTime} goal. Hold the plan.`;
  }
  if (t.verdict === 'close') {
    return `Current trend lands at ${projected} - ${deltaS.toFixed(1)}s outside the ${goalTime} goal. Within reach if the trend holds.`;
  }
  const perWeek = t.required_per_week_ms != null ? ` It needs to fall ~${(t.required_per_week_ms / 1000).toFixed(1)}s per week from your PB.` : '';
  return `Current trend lands at ${projected} - ${deltaS.toFixed(1)}s outside the ${goalTime} goal.${perWeek} Consider more race-pace work, or revise the goal.`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
