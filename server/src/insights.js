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
const HR_DRIFT_LOW = 5; // % - tight aerobic control
const HR_DRIFT_HIGH = 10; // % - faded in the back half
const REP_SPREAD_TIGHT_S = 1.5; // s/500m fastest-to-slowest rep → even set
const REP_SPREAD_WIDE_S = 4.0; // s/500m spread → pacing drifted
const REP_RATE_SPIKE_SPM = 2.5; // spm above the set average → spike
const RECOVERY_GOOD_BPM = 10; // avg HR drop between reps → recovering well
const RECOVERY_POOR_BPM = 3; // avg HR drop between reps → rests too short
const NUDGE_MIN_SESSIONS = 3; // sessions per window before a trend is trusted
const NUDGE_DRIFT_PP = 3; // percentage-point move in median HR drift
const NUDGE_STROKE_PCT = 0.02; // 2% move in median distance per stroke
const NUDGE_AEROBIC_PCT = 0.03; // 3% move in median watts per beat
const NUDGE_SAME_PACE_S = 2.0; // windows comparable if median paces this close
const NUDGE_HR_BPM = 4; // bpm move at a comparable pace worth naming

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

// pace_ms (per 500m) → "1:46.6"
function fmtPace(paceMs) {
  const totalSeconds = paceMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
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

  // Nothing rowed this week - say so plainly rather than inventing a trend.
  if (weeklyMeters <= 0 && sessionsThisWeek <= 0) {
    out.push(insight('volume', 'watch', 'No rows logged in the last 7 days. Time to get back on the erg.'));
    return out;
  }

  // 1. Volume vs last week.
  if (prevWeeklyMeters > 0) {
    const change = (weeklyMeters - prevWeeklyMeters) / prevWeeklyMeters;
    if (change >= VOLUME_UP_PCT) {
      out.push(insight('volume', 'positive', `${km(weeklyMeters)} this week, up ${pct(change)} on last week.`));
    } else if (change <= VOLUME_DOWN_PCT) {
      out.push(insight('volume', 'watch', `${km(weeklyMeters)} this week, down ${pct(change)} on last week.`));
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
      out.push(insight('fitness', 'positive', `Fitness ${signed(fitnessDelta7d)} over the past week. The work is building.`));
    } else if (fitnessDelta7d <= -FITNESS_MOVE) {
      out.push(insight('fitness', 'watch', `Fitness ${signed(fitnessDelta7d)} over the past week. Volume has eased off.`));
    }
  }

  // 4. Form / readiness (TSB = fitness − fatigue).
  if (form != null) {
    if (form >= FORM_FRESH) {
      out.push(insight('form', 'positive', `Form is fresh (${signed(form)}), a good window for a 2k or hard test.`));
    } else if (form <= FORM_TIRED) {
      out.push(insight('form', 'watch', `Fatigue is elevated (form ${signed(form)}). Favour easy sessions for a few days.`));
    } else {
      out.push(insight('form', 'neutral', `Form is balanced (${signed(form)}). Steady training is landing well.`));
    }
  }

  // 5. Consistency streak.
  if (streakWeeks >= 2) {
    out.push(insight('streak', 'positive', `${streakWeeks}-week rowing streak. Consistency is your biggest asset.`));
  }

  return out;
}

// Structured companion to the prose insights. The Progress overview needs
// numbers it can format in the athlete's preferred units, plus one decisive
// status whose priority is stable and testable. Fixed windows are intentional:
// current training load is a 7-day signal while endurance pace moves slowly
// enough to compare in 30-day blocks.
export function buildWeeklyOverview(input = {}) {
  const {
    weeklyMeters = 0,
    prevWeeklyMeters = 0,
    sessionsThisWeek = 0,
    fitness = null,
    form = null,
    fitnessDelta7d = null,
    recentEndurancePaceMs = null,
    priorEndurancePaceMs = null,
  } = input;

  const insights = buildWeeklyInsights(input);
  const byId = Object.fromEntries(insights.map(item => [item.id, item]));

  let status;
  if (weeklyMeters <= 0 && sessionsThisWeek <= 0) {
    status = {
      key: 'idle',
      label: 'No recent training',
      tone: 'watch',
      summary: 'No rows have been logged in the last 7 days.',
    };
  } else if (form != null && form <= FORM_TIRED) {
    status = {
      key: 'fatigued',
      label: 'Fatigued',
      tone: 'watch',
      summary: 'Fatigue is elevated. Favour easy sessions for a few days.',
    };
  } else if (byId.volume?.kind === 'positive' || byId.fitness?.kind === 'positive') {
    status = {
      key: 'building',
      label: 'Building',
      tone: 'positive',
      summary: 'Training load or fitness is moving in the right direction.',
    };
  } else if (byId.volume?.kind === 'watch' || byId.fitness?.kind === 'watch') {
    status = {
      key: 'easing',
      label: 'Easing',
      tone: 'watch',
      summary: 'Training load has eased compared with your recent baseline.',
    };
  } else {
    status = {
      key: 'steady',
      label: 'Steady',
      tone: 'neutral',
      summary: 'Training is landing consistently without a strong swing.',
    };
  }

  const volumeDeltaPct = prevWeeklyMeters > 0
    ? (weeklyMeters - prevWeeklyMeters) / prevWeeklyMeters
    : null;
  const paceDeltaMs = recentEndurancePaceMs != null && priorEndurancePaceMs != null
    ? recentEndurancePaceMs - priorEndurancePaceMs
    : null;
  const readiness = form == null
    ? null
    : form >= FORM_FRESH
      ? 'fresh'
      : form <= FORM_TIRED
        ? 'fatigued'
        : 'balanced';

  return {
    status,
    signals: {
      volume: {
        value_meters: weeklyMeters,
        delta_pct: volumeDeltaPct,
        sessions: sessionsThisWeek,
        window_days: 7,
      },
      fitness: {
        value: fitness,
        delta_7d: fitnessDelta7d,
      },
      form: {
        value: form,
        readiness,
      },
      pace: {
        value_ms: recentEndurancePaceMs,
        delta_ms: paceDeltaMs,
        window_days: 30,
      },
    },
    insights,
  };
}

// -----------------------------------------------------------------------------
// Trend nudges: slow-moving technique and efficiency signals that no single
// session shows. Each metric is already computed per workout; this compares
// steady-session medians across two windows (callers use the last 3 weeks vs
// the 6 weeks before) and only speaks when both windows have enough sessions
// and the move clears a named threshold. Same { id, kind, text } shape as the
// weekly insights.
// -----------------------------------------------------------------------------
function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function trendPair(recent = [], prior = []) {
  if (recent.length < NUDGE_MIN_SESSIONS || prior.length < NUDGE_MIN_SESSIONS) return null;
  const now = median(recent);
  const then = median(prior);
  if (now == null || then == null) return null;
  return { now, then };
}

export function buildTrendNudges(input = {}) {
  const { recent = {}, prior = {} } = input;
  const out = [];

  // 1. HR drift on steady rows: rising drift means the back half keeps
  // getting harder - aerobic endurance slipping or fatigue accumulating.
  const drift = trendPair(recent.hrDriftPct, prior.hrDriftPct);
  if (drift) {
    if (drift.now - drift.then >= NUDGE_DRIFT_PP) {
      out.push(insight('drift_trend', 'watch', `HR drift on steady rows has climbed from ~${drift.then.toFixed(0)}% to ~${drift.now.toFixed(0)}% over six weeks. Endurance may be slipping, or fatigue is building.`));
    } else if (drift.then - drift.now >= NUDGE_DRIFT_PP) {
      out.push(insight('drift_trend', 'positive', `HR drift on steady rows is down from ~${drift.then.toFixed(0)}% to ~${drift.now.toFixed(0)}% over six weeks. Aerobic control is improving.`));
    }
  }

  // 2. Distance per stroke: the cleanest technique trend in the data.
  const stroke = trendPair(recent.distancePerStroke, prior.distancePerStroke);
  if (stroke && stroke.then > 0) {
    const change = (stroke.now - stroke.then) / stroke.then;
    if (change >= NUDGE_STROKE_PCT) {
      out.push(insight('stroke_trend', 'positive', `${stroke.now.toFixed(2)}m per stroke on steady rows, up from ${stroke.then.toFixed(2)}m six weeks ago. Technique is paying off.`));
    } else if (change <= -NUDGE_STROKE_PCT) {
      out.push(insight('stroke_trend', 'watch', `Distance per stroke has slipped from ${stroke.then.toFixed(2)}m to ${stroke.now.toFixed(2)}m over six weeks. Worth a technique check.`));
    }
  }

  // 3. Watts per heartbeat: aerobic engine output per unit of effort.
  const aerobic = trendPair(recent.wattsPerBeat, prior.wattsPerBeat);
  if (aerobic && aerobic.then > 0) {
    const change = (aerobic.now - aerobic.then) / aerobic.then;
    if (change >= NUDGE_AEROBIC_PCT) {
      out.push(insight('aerobic_trend', 'positive', `${pct(change)} more watts per heartbeat than six weeks ago. The aerobic engine is growing.`));
    } else if (change <= -NUDGE_AEROBIC_PCT) {
      out.push(insight('aerobic_trend', 'watch', `Watts per heartbeat is down ${pct(change)} vs six weeks ago. Could be fatigue - ease off if it persists.`));
    }
  }

  // 4. Heart-rate cost of the same pace - only meaningful when the two
  // windows were rowed at genuinely comparable steady paces.
  const pace = trendPair(recent.paceMs, prior.paceMs);
  const hr = trendPair(recent.hrAvg, prior.hrAvg);
  if (pace && hr && paceGapSeconds(pace.now, pace.then) <= NUDGE_SAME_PACE_S) {
    const hrGap = hr.now - hr.then;
    if (hrGap >= NUDGE_HR_BPM) {
      out.push(insight('pace_cost', 'watch', `Your usual steady pace is costing ~${Math.round(hrGap)} bpm more than six weeks ago. Watch recovery and sleep.`));
    } else if (hrGap <= -NUDGE_HR_BPM) {
      out.push(insight('pace_cost', 'positive', `Same steady pace, ~${Math.round(-hrGap)} bpm lower heart rate than six weeks ago. Fitness is doing its job.`));
    }
  }

  return out;
}

// -----------------------------------------------------------------------------
// Per-workout insight, shown on the session detail page.
// `workout` is the formatted workout (pace_ms, heart_rate_avg, inferred_tag,
// metrics{ hr_drift_pct, ... }); `baseline` holds the rower's medians for the
// same tag so the session can be read relative to what's normal for them.
// `session` optionally carries the interval rows and HR recoveries so interval
// sets get rep-level insights.
// -----------------------------------------------------------------------------
export function buildWorkoutInsight(workout = {}, baseline = {}, session = {}) {
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

  // Heart rate relative to normal - most meaningful at a comparable pace.
  if (
    workout.heart_rate_avg > 0 && medianHr > 0 && medianPaceMs > 0 &&
    Math.abs(workout.pace_ms - medianPaceMs) <= 3000 // within ~3s/500m
  ) {
    const hrGap = medianHr - workout.heart_rate_avg;
    if (hrGap >= WORKOUT_HR_BPM) {
      out.push(insight('hr', 'positive', `HR ~${Math.round(hrGap)} bpm lower than usual at this pace, a good aerobic sign.`));
    } else if (hrGap <= -WORKOUT_HR_BPM) {
      out.push(insight('hr', 'watch', `HR ~${Math.round(-hrGap)} bpm higher than usual at this pace. You may be tired or working hard.`));
    }
  }

  // Aerobic decoupling over the piece (endurance rows only).
  if (tag === 'endurance' && driftPct != null) {
    if (driftPct <= HR_DRIFT_LOW) {
      out.push(insight('drift', 'positive', `Only ${driftPct.toFixed(0)}% HR drift, showing strong aerobic control throughout.`));
    } else if (driftPct >= HR_DRIFT_HIGH) {
      out.push(insight('drift', 'watch', `${driftPct.toFixed(0)}% HR drift. Effort crept up in the back half.`));
    }
  }

  if (tag === 'interval') {
    out.push(...buildIntervalInsights(session));
  }

  return out;
}

// Rep-level reads for an interval set: pacing evenness, rate spikes, and how
// well HR recovered in the rests. Rep numbers count work reps only, matching
// the reps chart.
function buildIntervalInsights(session = {}) {
  const out = [];
  const workReps = (session.intervals || [])
    .filter(row => row.type !== 'rest' && row.pace_ms > 0);
  if (workReps.length < 2) return out;

  // 1. Pacing across the set: spread between fastest and slowest rep.
  const paces = workReps.map(rep => rep.pace_ms);
  const fastest = Math.min(...paces);
  const fastestRep = paces.indexOf(fastest) + 1;
  const spreadS = (Math.max(...paces) - fastest) / 1000;
  const fastestText = `rep ${fastestRep} fastest at ${fmtPace(fastest)}`;

  if (spreadS <= REP_SPREAD_TIGHT_S) {
    out.push(insight('reps', 'positive', `${workReps.length} reps within ${spreadS.toFixed(1)} s/500m, an even set with ${fastestText}.`));
  } else if (fastestRep === workReps.length) {
    out.push(insight('reps', 'positive', `Finished strongest, with ${fastestText}.`));
  } else if (spreadS >= REP_SPREAD_WIDE_S) {
    out.push(insight('reps', 'watch', `${spreadS.toFixed(1)} s/500m between fastest and slowest rep. Pacing drifted (${fastestText}).`));
  } else {
    out.push(insight('reps', 'neutral', `${capitalize(fastestText)}.`));
  }

  // 2. Stroke-rate spike relative to the set average.
  const rates = workReps.map(rep => rep.stroke_rate).filter(rate => rate > 0);
  if (rates.length === workReps.length) {
    const avgRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    const maxRate = Math.max(...rates);
    if (maxRate - avgRate >= REP_RATE_SPIKE_SPM) {
      const spikeRep = rates.indexOf(maxRate) + 1;
      out.push(insight('rate_spike', 'watch', `Rate spiked to ${maxRate.toFixed(1)} spm on rep ${spikeRep} (set average ${avgRate.toFixed(1)}).`));
    }
  }

  // 3. HR recovery between reps.
  const drops = (session.recoveries || [])
    .map(r => r.drop_bpm)
    .filter(drop => drop != null);
  if (drops.length >= 2) {
    const avgDrop = drops.reduce((sum, drop) => sum + drop, 0) / drops.length;
    if (avgDrop >= RECOVERY_GOOD_BPM) {
      out.push(insight('recovery', 'positive', `HR dropped ~${Math.round(avgDrop)} bpm between reps, recovering well in the rests.`));
    } else if (avgDrop <= RECOVERY_POOR_BPM) {
      out.push(insight('recovery', 'watch', `HR recovered only ~${Math.round(avgDrop)} bpm between reps. The rests are short for this effort.`));
    }
  }

  return out;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
