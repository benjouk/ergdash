// Rules-based insight generation: plain data in, insight objects out, no DB.
// Each insight is { id, kind, text } where kind is 'positive' | 'neutral' | 'watch'.
// Kept dependency-free and deterministic so it's trivially unit-testable and
// works identically in the self-hosted app and the static demo build.

// --- Thresholds (all named so the behaviour is easy to tune) -----------------
const VOLUME_UP_PCT = 0.05; // ≥ +5% week-on-week reads as a genuine build
const VOLUME_DOWN_PCT = -0.2; // ≤ −20% reads as a real drop-off
const FITNESS_MOVE = 1.0; // CTL points over the week to call a trend
const FORM_FRESH = 5; // form (TSB) at/above → fresh enough to test
const FORM_TIRED = -10; // form at/below → carrying real fatigue
const PACE_FASTER_S = 1.0; // s/500m improvement to highlight
const PACE_SLOWER_S = 2.0; // s/500m regression to flag
const WORKOUT_PACE_S = 1.5; // session vs personal median, s/500m
const WORKOUT_HR_BPM = 4; // session HR vs median at similar effort
const HR_DRIFT_LOW = 5; // % — tight aerobic control
const HR_DRIFT_HIGH = 10; // % — faded in the back half

// --- Formatting helpers (self-contained; server pace_ms is per-500m) ---------
function km(meters) {
  return `${(meters / 1000).toFixed(1)} km`;
}

function pct(value) {
  return `${Math.round(Math.abs(value) * 100)}%`;
}

function signed(value, digits = 1) {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

// s/500m gap between two pace_ms values, always positive, 1dp.
function paceGapSeconds(aMs, bMs) {
  return Math.abs(aMs - bMs) / 1000;
}

function insight(id, kind, text) {
  return { id, kind, text };
}

// -----------------------------------------------------------------------------
// Weekly "This week" coach summary.
// All inputs are already computed by the caller from the same queries the
// /summary and /fitness routes run; missing values are simply skipped.
// -----------------------------------------------------------------------------
export function buildWeeklyInsights(input = {}) {
  const {
    weeklyMeters = 0,
    prevWeeklyMeters = 0,
    sessionsThisWeek = 0,
    streakWeeks = 0,
    fitness = null,
    fatigue = null,
    form = null,
    fitnessDelta7d = null,
    recentEndurancePaceMs = null,
    priorEndurancePaceMs = null,
  } = input;

  const out = [];

  // Nothing rowed this week — say so plainly rather than inventing a trend.
  if (weeklyMeters <= 0 && sessionsThisWeek <= 0) {
    out.push(insight('volume', 'watch', 'No rows logged in the last 7 days — time to get back on the erg.'));
    return out;
  }

  // 1. Volume vs last week.
  if (prevWeeklyMeters > 0) {
    const change = (weeklyMeters - prevWeeklyMeters) / prevWeeklyMeters;
    if (change >= VOLUME_UP_PCT) {
      out.push(insight('volume', 'positive', `${km(weeklyMeters)} this week — up ${pct(change)} on last week.`));
    } else if (change <= VOLUME_DOWN_PCT) {
      out.push(insight('volume', 'watch', `${km(weeklyMeters)} this week — down ${pct(change)} on last week.`));
    } else {
      out.push(insight('volume', 'neutral', `${km(weeklyMeters)} this week, in line with last week.`));
    }
  } else if (weeklyMeters > 0) {
    out.push(insight('volume', 'neutral', `${km(weeklyMeters)} across ${sessionsThisWeek} session${sessionsThisWeek === 1 ? '' : 's'} this week.`));
  }

  // 2. Endurance pace trend (recent vs the preceding block).
  if (recentEndurancePaceMs > 0 && priorEndurancePaceMs > 0) {
    const gap = paceGapSeconds(recentEndurancePaceMs, priorEndurancePaceMs);
    if (recentEndurancePaceMs <= priorEndurancePaceMs - PACE_FASTER_S * 1000) {
      out.push(insight('pace', 'positive', `Endurance pace improved ${gap.toFixed(1)} s/500m vs the previous month.`));
    } else if (recentEndurancePaceMs >= priorEndurancePaceMs + PACE_SLOWER_S * 1000) {
      out.push(insight('pace', 'watch', `Endurance pace is ${gap.toFixed(1)} s/500m slower than the previous month.`));
    }
  }

  // 3. Fitness (CTL) direction over the week.
  if (fitnessDelta7d != null) {
    if (fitnessDelta7d >= FITNESS_MOVE) {
      out.push(insight('fitness', 'positive', `Fitness ${signed(fitnessDelta7d)} over the past week — the work is building.`));
    } else if (fitnessDelta7d <= -FITNESS_MOVE) {
      out.push(insight('fitness', 'watch', `Fitness ${signed(fitnessDelta7d)} over the past week — volume has eased off.`));
    }
  }

  // 4. Form / readiness (TSB = fitness − fatigue).
  if (form != null) {
    if (form >= FORM_FRESH) {
      out.push(insight('form', 'positive', `Form is fresh (${signed(form)}) — a good window for a 2k or hard test.`));
    } else if (form <= FORM_TIRED) {
      out.push(insight('form', 'watch', `Fatigue is elevated (form ${signed(form)}) — favour easy sessions for a few days.`));
    } else {
      out.push(insight('form', 'neutral', `Form is balanced (${signed(form)}) — steady training is landing well.`));
    }
  }

  // 5. Consistency streak.
  if (streakWeeks >= 2) {
    out.push(insight('streak', 'positive', `${streakWeeks}-week rowing streak — consistency is your biggest asset.`));
  }

  return out;
}

// -----------------------------------------------------------------------------
// Per-workout insight, shown on the session detail page.
// `workout` is the formatted workout (pace_ms, heart_rate_avg, inferred_tag,
// metrics{ hr_drift_pct, ... }); `baseline` holds the rower's medians for the
// same tag so the session can be read relative to what's normal for them.
// -----------------------------------------------------------------------------
export function buildWorkoutInsight(workout = {}, baseline = {}) {
  const out = [];
  const tag = workout.inferred_tag === 'interval' ? 'interval' : 'endurance';
  const { medianPaceMs = null, medianHr = null } = baseline;
  const driftPct = workout.metrics?.hr_drift_pct;

  // Pace relative to this rower's usual for the session type.
  if (workout.pace_ms > 0 && medianPaceMs > 0) {
    const gap = paceGapSeconds(workout.pace_ms, medianPaceMs);
    if (workout.pace_ms <= medianPaceMs - WORKOUT_PACE_S * 1000) {
      out.push(insight('pace', 'positive', `${gap.toFixed(1)} s/500m faster than your typical ${tag} session.`));
    } else if (workout.pace_ms >= medianPaceMs + WORKOUT_PACE_S * 1000) {
      out.push(insight('pace', 'neutral', `${gap.toFixed(1)} s/500m easier than your typical ${tag} session.`));
    }
  }

  // Heart rate relative to normal — most meaningful at a comparable pace.
  if (
    workout.heart_rate_avg > 0 && medianHr > 0 && medianPaceMs > 0 &&
    Math.abs(workout.pace_ms - medianPaceMs) <= 3000 // within ~3s/500m
  ) {
    const hrGap = medianHr - workout.heart_rate_avg;
    if (hrGap >= WORKOUT_HR_BPM) {
      out.push(insight('hr', 'positive', `HR ~${Math.round(hrGap)} bpm lower than usual at this pace — a good aerobic sign.`));
    } else if (hrGap <= -WORKOUT_HR_BPM) {
      out.push(insight('hr', 'watch', `HR ~${Math.round(-hrGap)} bpm higher than usual at this pace — tired or working hard.`));
    }
  }

  // Aerobic decoupling over the piece (endurance rows only).
  if (tag === 'endurance' && driftPct != null) {
    if (driftPct <= HR_DRIFT_LOW) {
      out.push(insight('drift', 'positive', `Only ${driftPct.toFixed(0)}% HR drift — strong aerobic control throughout.`));
    } else if (driftPct >= HR_DRIFT_HIGH) {
      out.push(insight('drift', 'watch', `${driftPct.toFixed(0)}% HR drift — effort crept up in the back half.`));
    }
  }

  return out;
}
