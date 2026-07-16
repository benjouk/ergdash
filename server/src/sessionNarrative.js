// Request-time coaching narrative for a completed session. This module is
// deliberately pure: it only interprets the formatted workout, its stored
// execution analysis, an optional matched plan and the athlete's tag baseline.

export const WORKOUT_INTENTS = Object.freeze([
  'steady',
  'hard_distance',
  'test_race',
  'recovery',
  'technique',
]);

const WORKOUT_INTENT_SET = new Set(WORKOUT_INTENTS);

// A difference has to clear these thresholds before the prose calls it out.
const TYPICAL_PACE_GAP_MS = 1500;
const COMPARABLE_PACE_GAP_MS = 3000;
const TYPICAL_HR_GAP_BPM = 4;
const PHASE_PACE_EVEN_PCT = 1;
const HIGH_HR_DRIFT_PCT = 10;

export function isWorkoutIntent(value) {
  return WORKOUT_INTENT_SET.has(value);
}

// Explicit user intent wins. A plan supplies intent only for types whose
// purpose is unambiguous; intervals and other plans still need the athlete's
// input because they can represent several kinds of work.
export function resolveWorkoutIntent(workout = {}, plan = workout?.plan ?? null) {
  if (isWorkoutIntent(workout?.intent)) {
    return { intent: workout.intent, intent_source: 'workout' };
  }

  const planIntent = plan?.type === 'steady'
    ? 'steady'
    : (plan?.type === 'test' || plan?.type === 'race' ? 'test_race' : null);
  return {
    intent: planIntent,
    intent_source: planIntent ? 'plan' : null,
  };
}

export function buildSessionNarrative(input = {}) {
  const workout = input.workout ?? {};
  const analysis = input.analysis ?? workout.analysis ?? null;
  const plan = input.plan ?? workout.plan ?? null;
  const baseline = input.baseline ?? {};
  const { intent, intent_source: intentSource } = resolveWorkoutIntent(workout, plan);
  const context = analysisContext(workout, analysis);
  const isInterval = context.isInterval;

  const narrative = {
    headline: isInterval
      ? intervalHeadline(workout, context)
      : continuousHeadline(workout, context),
    summary: isInterval
      ? intervalSummary(workout, context, baseline)
      : continuousSummary(workout, context, baseline),
    recommendation: recommendationFor(intent, context, plan),
    intent,
    intent_source: intentSource,
    needs_intent: intent == null,
  };

  return narrative;
}

function analysisContext(workout, analysis) {
  // The fallback to top-level metrics makes this tolerant of older fixtures and
  // target analysis objects while the versioned classifier shape evolves.
  const execution = analysis?.execution ?? analysis ?? {};
  const pacing = execution?.pacing ?? null;
  const rate = execution?.rate ?? null;
  const finish = execution?.finish ?? null;
  const intensity = execution?.intensity ?? null;
  const hrDrift = execution?.hr_drift ?? null;
  const shape = {
    ...(pacing?.shape ?? {}),
    fast_start: pacing?.shape?.fast_start ?? pacing?.fast_start ?? false,
    even_core: pacing?.shape?.even_core ?? pacing?.even_core ?? false,
    late_fade: pacing?.shape?.late_fade ?? pacing?.late_fade ?? false,
    fast_finish: pacing?.shape?.fast_finish ?? pacing?.fast_finish ?? false,
  };
  const intervalAnalysis = analysis?.intervals ?? execution?.intervals ?? null;
  const isInterval = analysis?.structure?.value === 'interval'
    || workout?.inferred_tag === 'interval'
    || intervalAnalysis != null;

  return {
    analysis,
    pacing,
    rate,
    finish,
    intensity,
    hrDrift,
    shape,
    phases: Array.isArray(analysis?.phases) ? analysis.phases : [],
    intervals: intervalAnalysis,
    isInterval,
    hrDriftPct: finiteNumber(hrDrift?.drift_percent)
      ?? finiteNumber(hrDrift?.drift_pct)
      ?? finiteNumber(workout?.metrics?.hr_drift_pct),
  };
}

function continuousHeadline(workout, context) {
  const pacing = context.pacing?.value;
  const finish = context.finish?.value;
  const { fast_start: fastStart, even_core: evenCore, late_fade: lateFade, fast_finish: fastFinish } = context.shape;

  if (lateFade || pacing === 'significant_fade' || (pacing === 'mild_fade' && finish === 'faded')) {
    return 'Faded through the back half';
  }
  if (evenCore && (fastFinish || finish === 'accelerated')) {
    return 'Controlled middle with a strong finish';
  }
  if (pacing === 'negative_split' && (fastFinish || finish === 'accelerated')) {
    return 'Built through the piece and finished strongly';
  }
  if (pacing === 'even' && finish === 'even') {
    return 'Even from start to finish';
  }
  if (pacing === 'negative_split') return 'Built pace through the second half';
  if (pacing === 'mild_fade') return 'A slight fade through the second half';
  if (pacing === 'variable') return 'Variable pacing across the piece';
  if (fastStart) return 'Fast opening before settling';
  if (fastFinish || finish === 'accelerated') return 'Strong finish after a steady middle';
  if (finish === 'faded') return 'Pace eased at the finish';
  if (pacing && pacing !== 'unknown') return 'A controlled continuous row';

  return workout?.distance > 0
    ? `${formatDistance(workout.distance)} session complete`
    : 'Session complete';
}

function continuousSummary(workout, context, baseline) {
  const sentences = [];
  const start = findPhase(context.phases, 'start');
  const middle = findPhase(context.phases, 'middle');
  const startPace = positiveNumber(start?.avg_pace_ms);
  const middlePace = positiveNumber(middle?.avg_pace_ms);

  if (startPace && middlePace) {
    const difference = startPace - middlePace;
    const gapSeconds = Math.abs(difference) / 1000;
    if (Math.abs(difference) <= middlePace * (PHASE_PACE_EVEN_PCT / 100)) {
      sentences.push('The opening matched the middle pace.');
    } else {
      sentences.push(`The opening was ${gapSeconds.toFixed(1)} s/500m ${difference < 0 ? 'faster' : 'slower'} than the middle.`);
    }
  }

  const coreSentence = describeCore(context);
  if (coreSentence) sentences.push(coreSentence);
  const finishSentence = describeFinish(context);
  if (finishSentence) sentences.push(finishSentence);
  if (sentences.length === 0) {
    const overview = describeSessionOverview(workout);
    if (overview) sentences.push(overview);
  }
  const rateSentence = describeRate(workout, context.rate);
  if (rateSentence) sentences.push(rateSentence);
  const driftSentence = describeDrift(context.hrDriftPct);
  if (driftSentence) sentences.push(driftSentence);
  sentences.push(...describeAgainstTypical(workout, baseline));

  if (sentences.length === 0) return fallbackWorkoutSummary(workout);
  return sentences.join(' ');
}

function intervalHeadline(workout, context) {
  const intervals = context.intervals ?? {};
  const repCount = positiveNumber(intervals.rep_count)
    ?? (Array.isArray(intervals.reps) ? intervals.reps.length : null);
  const degradation = finiteNumber(intervals.degradation_percent);
  const spread = finiteNumber(intervals.spread_percent);
  const fastestIndex = finiteNumber(intervals.fastest_rep_index);

  if (intervals.first_rep_fast && degradation != null && degradation > 1) {
    return 'Fast start, then a fade across the set';
  }
  if (degradation != null && degradation > 2) return 'Pace faded across the interval set';
  if (degradation != null && degradation < -1) return 'Finished the set with your strongest work';
  if (repCount && fastestIndex === repCount - 1) return 'Finished the set with your fastest rep';
  if (repCount && spread != null && spread <= 2) return `Consistent pacing across ${repCount} reps`;
  if (repCount) return `Completed ${repCount} work reps`;
  return workout?.interval_summary
    ? `${workout.interval_summary} session complete`
    : 'Interval session complete';
}

function intervalSummary(workout, context, baseline) {
  const intervals = context.intervals ?? {};
  const sentences = [];
  const repCount = positiveNumber(intervals.rep_count)
    ?? (Array.isArray(intervals.reps) ? intervals.reps.length : null);
  const spread = finiteNumber(intervals.spread_percent);
  const fastestIndex = finiteNumber(intervals.fastest_rep_index);
  const fastestPace = positiveNumber(intervals.fastest_pace_ms);
  const finalPace = positiveNumber(intervals.final_rep_pace_ms);

  if (repCount && spread != null) {
    sentences.push(`Across ${repCount} work reps, the fastest-to-slowest pace spread was ${formatAbsPercent(spread)}.`);
  } else if (repCount) {
    sentences.push(`The session contained ${repCount} work reps.`);
  }
  if (fastestIndex != null && fastestPace) {
    sentences.push(`Rep ${fastestIndex + 1} was fastest at ${formatPace(fastestPace)}/500m.`);
  }
  if (finalPace && fastestPace && finalPace !== fastestPace) {
    sentences.push(`The final rep averaged ${formatPace(finalPace)}/500m.`);
  }
  const rateSentence = describeRate(workout, context.rate);
  if (rateSentence) sentences.push(rateSentence);
  sentences.push(...describeAgainstTypical(workout, baseline));

  if (sentences.length === 0) return fallbackWorkoutSummary(workout);
  return sentences.join(' ');
}

function describeCore(context) {
  const pacing = context.pacing?.value;
  if (context.shape.late_fade) return 'Pace then faded through the late phase.';
  if (context.shape.even_core || pacing === 'even') return 'Pace stayed even through the core of the piece.';
  if (pacing === 'negative_split') return 'Pace built through the second half.';
  if (pacing === 'mild_fade') return 'Pace eased slightly through the back half.';
  if (pacing === 'significant_fade') return 'Pace faded through the back half.';
  if (pacing === 'variable') return 'Pace varied through the middle of the piece.';
  return null;
}

function describeFinish(context) {
  const finish = context.finish?.value;
  if (context.shape.fast_finish || finish === 'accelerated') return 'The final stretch accelerated.';
  if (finish === 'faded') return 'The final stretch eased.';
  if (finish === 'even') return 'The final stretch held pace.';
  return null;
}

function describeRate(workout, rate) {
  const average = finiteNumber(rate?.average_spm) ?? finiteNumber(workout?.stroke_rate);
  const variation = finiteNumber(rate?.variation_spm);
  if (average == null) return null;
  if (variation == null) return `Rate averaged ${formatNumber(average)} spm.`;
  if (rate?.value === 'stable_avg_variable_stroke') {
    return `Rate averaged ${formatNumber(average)} spm with stable phase averages, while stroke-to-stroke variation was ${formatNumber(variation)} spm.`;
  }
  return `Rate averaged ${formatNumber(average)} spm, with ${formatNumber(variation)} spm stroke-to-stroke variation.`;
}

function describeDrift(driftPct) {
  if (driftPct == null) return null;
  if (driftPct > 0.05) {
    return `Power-to-HR efficiency declined by ${formatAbsPercent(driftPct)} between the measured halves.`;
  }
  if (driftPct < -0.05) {
    return `Power-to-HR efficiency improved by ${formatAbsPercent(driftPct)} between the measured halves.`;
  }
  return `Power-to-HR efficiency was unchanged between the measured halves (${formatSignedPercent(driftPct)} drift).`;
}

function describeAgainstTypical(workout, baseline) {
  const sentences = [];
  const workoutPace = positiveNumber(workout?.pace_ms);
  const medianPace = positiveNumber(baseline?.medianPaceMs);
  const workoutHr = positiveNumber(workout?.heart_rate_avg);
  const medianHr = positiveNumber(baseline?.medianHr);
  const tag = workout?.inferred_tag === 'interval' ? 'interval' : 'endurance';

  if (workoutPace && medianPace && Math.abs(workoutPace - medianPace) >= TYPICAL_PACE_GAP_MS) {
    sentences.push(`${(Math.abs(workoutPace - medianPace) / 1000).toFixed(1)} s/500m ${workoutPace < medianPace ? 'faster' : 'easier'} than your typical ${tag} session.`);
  }
  if (
    workoutPace && medianPace && workoutHr && medianHr
    && Math.abs(workoutPace - medianPace) <= COMPARABLE_PACE_GAP_MS
    && Math.abs(workoutHr - medianHr) >= TYPICAL_HR_GAP_BPM
  ) {
    sentences.push(`Average HR was about ${Math.round(Math.abs(workoutHr - medianHr))} bpm ${workoutHr < medianHr ? 'lower' : 'higher'} than usual at a comparable pace.`);
  }
  return sentences;
}

function recommendationFor(intent, context, plan) {
  const pacing = context.pacing?.value;
  const finish = context.finish?.value;
  const fastStart = context.shape.fast_start;
  const strongFinish = context.shape.fast_finish || finish === 'accelerated';
  const faded = context.shape.late_fade || pacing === 'mild_fade' || pacing === 'significant_fade';
  const averageRate = finiteNumber(context.rate?.average_spm);
  const targetRate = positiveNumber(plan?.target_rate) ?? (averageRate == null ? null : Math.round(averageRate));
  const rhythm = targetRate ? ` around ${formatNumber(targetRate)} spm` : '';
  const rateVariable = context.rate?.value === 'variable'
    || context.rate?.value === 'stable_avg_variable_stroke';
  const hasPacingRead = (pacing != null && pacing !== 'unknown')
    || (finish != null && finish !== 'unknown')
    || fastStart || strongFinish || context.shape.late_fade;

  if (context.isInterval) {
    const intervalRecommendation = recommendationForIntervals(intent, context, rhythm, rateVariable);
    if (intervalRecommendation) return intervalRecommendation;
  }

  if (intent === 'steady') {
    if (fastStart || faded) {
      return `For steady work, make the opening slightly slower and settle into a smooth rhythm${rhythm}.`;
    }
    if (rateVariable) {
      return `For steady work, keep the pace controlled and reduce stroke-to-stroke rate variation${rhythm}.`;
    }
    if (context.hrDriftPct != null && context.hrDriftPct > HIGH_HR_DRIFT_PCT) {
      return 'For steady work, ease the pressure slightly so output and heart rate stay better coupled through the back half.';
    }
    if (!hasPacingRead) {
      return `For steady work, keep the opening controlled and settle into a smooth rhythm${rhythm}.`;
    }
    return `For steady work, repeat this pacing pattern and keep the rate smooth${rhythm}.`;
  }

  if (intent === 'hard_distance') {
    if (fastStart || faded) {
      return 'For the next hard-distance row, hold back slightly in the opening so you can sustain pace through the back half.';
    }
    if (strongFinish) {
      return 'This was controlled for a hard-distance effort, so next time bring the middle pace up slightly while preserving the finish.';
    }
    if (!hasPacingRead) {
      return 'For hard-distance work, establish a sustainable opening pace and build the pressure through the final quarter.';
    }
    return 'Pacing control suited a hard-distance effort, so keep the same opening and begin the final press a little earlier.';
  }

  if (intent === 'test_race') {
    if (fastStart || faded) {
      return 'For the next test or race, open slightly slower and protect the target pace through the final quarter.';
    }
    if (strongFinish) {
      return 'You finished with capacity in hand, so next time begin the final drive a little earlier.';
    }
    if (!hasPacingRead) {
      return 'For the next test or race, set a sustainable opening pace and plan where the final drive will begin.';
    }
    return 'For the next test or race, keep this pacing control and commit to the final drive before the closing stretch.';
  }

  if (intent === 'recovery') {
    if (['hard', 'very_hard', 'maximal'].includes(context.intensity?.value)) {
      return `This registered above a recovery effort, so lower the pressure and keep the rate relaxed${rhythm}.`;
    }
    return `For recovery work, keep the pressure light and the stroke rhythm relaxed${rhythm}.`;
  }

  if (intent === 'technique') {
    return `For technique work, keep pace secondary and aim to reduce stroke-to-stroke rate variation${rhythm}.`;
  }

  if (!hasPacingRead) {
    return 'If this was steady work, prioritise a smooth, controlled rhythm. If it was a hard effort, establish a sustainable opening pace and plan where to press.';
  }
  return 'If this was steady work, prioritise a smoother, controlled opening. If it was a hard effort, use the pacing pattern to decide whether to start more conservatively or press earlier.';
}

function recommendationForIntervals(intent, context, rhythm, rateVariable) {
  const intervals = context.intervals;
  if (!intervals) return null;

  const degradation = finiteNumber(intervals.degradation_percent);
  const spread = finiteNumber(intervals.spread_percent);
  const repCount = positiveNumber(intervals.rep_count);
  const fastestIndex = finiteNumber(intervals.fastest_rep_index);
  const faded = intervals.first_rep_fast || (degradation != null && degradation > 1);
  const built = degradation != null && degradation < -1;
  const evenSet = spread != null && spread <= 2;
  const finishedFastest = repCount != null && fastestIndex === repCount - 1;

  if (intent === 'steady') {
    if (faded) {
      return `For steady interval work, open the first rep more conservatively and aim for even pace across the set${rhythm}.`;
    }
    if (rateVariable) {
      return `For steady interval work, keep rep pace controlled and smooth the stroke-to-stroke rate${rhythm}.`;
    }
    return `For steady interval work, keep the reps even and the rhythm smooth${rhythm}.`;
  }

  if (intent === 'hard_distance') {
    if (faded) {
      return 'For the next hard interval set, hold back on the first rep and protect pace through the final reps.';
    }
    if (built || finishedFastest) {
      return 'You finished the set strongly, so next time bring the early reps slightly closer to that sustainable pace.';
    }
    if (evenSet) {
      return 'Rep pacing was controlled for a hard set, so repeat the even opening and press only in the final reps.';
    }
    return 'For the next hard interval set, use the opening reps to establish a pace you can hold through the finish.';
  }

  if (intent === 'test_race') {
    if (faded) {
      return 'For the next race-specific set, make the first rep more conservative and protect target pace through the finish.';
    }
    if (built || finishedFastest) {
      return 'You had pace in hand late in the set, so next time bring the early reps slightly closer to race pace.';
    }
    return 'For the next race-specific set, keep the rep pacing controlled and commit to target pace in the closing reps.';
  }

  if (intent == null) {
    return 'If this was steady interval work, prioritise even reps and smooth rate. If it was a hard set, judge whether the first rep left enough pace for the finish.';
  }

  return null;
}


function fallbackWorkoutSummary(workout) {
  const overview = describeSessionOverview(workout);
  if (overview) return overview;
  if (workout?.stroke_rate > 0) {
    return `The session averaged ${formatNumber(workout.stroke_rate)} spm.`;
  }
  return 'The session is recorded, but there is not enough execution data for a detailed summary.';
}

function describeSessionOverview(workout) {
  const distance = positiveNumber(workout?.distance);
  const pace = positiveNumber(workout?.pace_ms);
  if (distance && pace) {
    return `You completed ${formatDistance(distance)} at an average ${formatPace(pace)}/500m.`;
  }
  if (distance) return `You completed ${formatDistance(distance)}.`;
  if (pace) return `Average pace was ${formatPace(pace)}/500m.`;
  return null;
}

function findPhase(phases, name) {
  return phases.find(phase => phase?.name === name) ?? null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatNumber(value) {
  const rounded = round(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatAbsPercent(value) {
  return `${Math.abs(value).toFixed(1)}%`;
}

function formatSignedPercent(value) {
  const rounded = round(value);
  return `${rounded > 0 ? '+' : ''}${formatNumber(rounded)}%`;
}

function formatPace(paceMs) {
  const totalSeconds = paceMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function formatDistance(meters) {
  const rounded = Math.round(meters);
  if (rounded >= 1000 && rounded % 1000 === 0) return `${rounded / 1000} km`;
  return `${rounded.toLocaleString('en-GB')} m`;
}
