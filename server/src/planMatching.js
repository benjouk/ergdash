import { getDb } from './db.js';

// Matching heuristic for linking synced workouts to planned ones. A workout
// is only ever matched to a plan on the same calendar day; among same-day
// candidates the closest distance/duration wins. scorePlanMatch and
// pickBestMatch are pure so the heuristic is unit-testable.

// A target within 20% of the actual counts as "the session you planned".
export const TARGET_TOLERANCE = 0.2;

// Score awarded when a plan's targets don't line up but it is the only
// plan that day - a loosely specified plan still counts as followed.
const FLOOR_SCORE = 0.1;

const TYPE_BONUS = 0.05;

export function workoutDay(workout) {
  return String(workout.date).slice(0, 10);
}

// Returns a comparable score, or null when the plan is not a valid match
// for this workout. Assumes same-day eligibility was already established.
export function scorePlanMatch(plan, workout, { onlyPlanOfDay = false } = {}) {
  let score = 0;
  let withinTolerance = false;

  if (plan.target_distance > 0 && workout.distance > 0) {
    const similarity = 1 - Math.abs(workout.distance - plan.target_distance) / plan.target_distance;
    if (similarity >= 1 - TARGET_TOLERANCE) {
      score += similarity;
      withinTolerance = true;
    }
  }

  if (plan.target_duration_ms > 0 && workout.time_ms > 0) {
    const similarity = 1 - Math.abs(workout.time_ms - plan.target_duration_ms) / plan.target_duration_ms;
    if (similarity >= 1 - TARGET_TOLERANCE) {
      score += similarity;
      withinTolerance = true;
    }
  }

  if (!withinTolerance) {
    if (!onlyPlanOfDay) return null;
    score = FLOOR_SCORE;
  }

  const workoutIsInterval = workout.inferred_tag === 'interval';
  const planIsInterval = plan.type === 'intervals';
  if (workoutIsInterval === planIsInterval) {
    score += TYPE_BONUS;
  }

  return score;
}

// Best open same-day plan for a workout, or null. Plans that are already
// completed/skipped or linked are never candidates, so manual links and
// earlier auto-links are never stolen.
export function pickBestMatch(plans, workout) {
  const day = workoutDay(workout);
  const eligible = (plans || []).filter(p =>
    p.status === 'planned' && !p.completed_workout_id && p.date === day);
  const onlyPlanOfDay = eligible.length === 1;

  let best = null;
  let bestScore = -Infinity;
  for (const plan of eligible) {
    const score = scorePlanMatch(plan, workout, { onlyPlanOfDay });
    if (score != null && score > bestScore) {
      best = plan;
      bestScore = score;
    }
  }
  return best;
}

function linkPlan(db, planId, workoutId, matchType) {
  db.prepare(`
    UPDATE planned_workouts
    SET completed_workout_id = ?, status = 'completed', match_type = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(workoutId, matchType, planId);
}

// Post-sync hook: try to complete open plans with the workouts that just
// arrived. Returns how many plans were linked.
export function matchNewWorkouts(insertedWorkoutIds = []) {
  if (insertedWorkoutIds.length === 0) return 0;
  const db = getDb();
  let matched = 0;

  for (const id of insertedWorkoutIds) {
    const workout = db.prepare(`
      SELECT id, profile_id, date, distance, time_ms, inferred_tag
      FROM workouts WHERE id = ? AND type = 'rower'
    `).get(id);
    if (!workout) continue;

    const alreadyLinked = db.prepare(
      'SELECT id FROM planned_workouts WHERE completed_workout_id = ?'
    ).get(id);
    if (alreadyLinked) continue;

    // Invariant: a plan may only link to a workout owned by the same profile.
    const dayPlans = db.prepare(
      'SELECT * FROM planned_workouts WHERE date = ? AND profile_id = ?'
    ).all(workoutDay(workout), workout.profile_id);

    const best = pickBestMatch(dayPlans, workout);
    if (best) {
      linkPlan(db, best.id, workout.id, 'auto');
      matched++;
    }
  }

  return matched;
}

// When a plan is created or moved to a date that already has an unmatched
// workout ("logged the plan after rowing it"), try to complete it right away.
export function autoMatchPlan(planId) {
  const db = getDb();
  const plan = db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(planId);
  if (!plan || plan.status !== 'planned' || plan.completed_workout_id) return false;

  // Invariant: a plan may only link to a workout owned by the same profile.
  const candidates = db.prepare(`
    SELECT w.id, w.date, w.distance, w.time_ms, w.inferred_tag
    FROM workouts w
    WHERE w.type = 'rower' AND date(w.date) = ? AND w.profile_id = ?
      AND w.id NOT IN (
        SELECT completed_workout_id FROM planned_workouts
        WHERE completed_workout_id IS NOT NULL
      )
    ORDER BY w.date
  `).all(plan.date, plan.profile_id);

  const dayPlans = db.prepare(
    'SELECT * FROM planned_workouts WHERE date = ? AND profile_id = ?'
  ).all(plan.date, plan.profile_id);

  for (const workout of candidates) {
    const best = pickBestMatch(dayPlans, workout);
    if (best && best.id === plan.id) {
      linkPlan(db, plan.id, workout.id, 'auto');
      return true;
    }
  }
  return false;
}
