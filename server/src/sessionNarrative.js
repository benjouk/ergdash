// Request-time coaching narrative for a completed session. This module is
// deliberately pure: it only interprets the formatted workout, its stored
// execution analysis and the athlete's tag baseline.

// A difference has to clear these thresholds before the prose calls it out.
const TYPICAL_PACE_GAP_MS = 1500;
// A vs-typical pace comparison is only meaningful within a comparable band. A
// gap wider than this means the session was a different kind of work (a test
// or hard piece against easy endurance days), not a faster version of it.
const COMPARABLE_MAX_PACE_GAP_MS = 8000;
// Below this a piece is too short to sit against the endurance median, which is
// weighted by long steady rows: a 2k reads "faster than typical" on distance
// alone, not fitness. Short pieces skip the endurance comparison.
const COMPARABLE_MIN_DISTANCE_M = 5000;
const COMPARABLE_PACE_GAP_MS = 3000;
const TYPICAL_HR_GAP_BPM = 4;
const PHASE_PACE_EVEN_PCT = 1;
const HIGH_HR_DRIFT_PCT = 10;
const NOTABLE_HR_DRIFT_PCT = 5;
// On a long piece, a smaller power-to-HR decline than HIGH_HR_DRIFT_PCT is
// still the durability signal worth coaching, ahead of a finishing kick.
const LONG_PIECE_DRIFT_PCT = 6;
// A piece is "long" (aerobic-durability territory, where drift matters) past
// either of these; short hard efforts are expected to drift and are excluded.
const LONG_PIECE_DISTANCE_M = 8000;
const LONG_PIECE_TIME_MS = 20 * 60 * 1000;
// Beyond this, an opening-vs-middle pace gap is session structure (warmup,
// stops, padding), not a pacing choice, so the prose stays quiet about it.
const OPENING_STRUCTURE_CAP_PCT = 12;
// Effort reads that put the piece well above endurance; the vs-typical
// endurance comparison is dropped for these because they are not comparable.
const HARD_EFFORT_VALUES = new Set(['very_hard', 'maximal']);

// The narrative describes what the recording shows. It no longer asks the
// athlete to declare an intent: heart rate and pacing are the reads, and the
// coaching stays observational so it can never contradict the measured effort.
export function buildSessionNarrative(input = {}) {
  const workout = input.workout ?? {};
  const analysis = input.analysis ?? workout.analysis ?? null;
  const baseline = input.baseline ?? {};
  const context = analysisContext(workout, analysis);
  const isInterval = context.isInterval;

  return {
    headline: isInterval
      ? intervalHeadline(workout, context)
      : continuousHeadline(workout, context),
    summary: isInterval
      ? intervalSummary(workout, context, baseline)
      : continuousSummary(workout, context, baseline),
    recommendation: recommendationFor(context),
  };
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
    longPiece: (positiveNumber(workout?.distance) ?? 0) >= LONG_PIECE_DISTANCE_M
      || (positiveNumber(workout?.time_ms) ?? 0) >= LONG_PIECE_TIME_MS,
    hrDriftPct: finiteNumber(hrDrift?.drift_percent)
      ?? finiteNumber(hrDrift?.drift_pct)
      ?? finiteNumber(workout?.metrics?.hr_drift_pct),
  };
}

function continuousHeadline(workout, context) {
  const pacing = context.pacing?.value;
  const finish = context.finish?.value;
  const { fast_start: fastStart, even_core: evenCore, late_fade: lateFade, fast_finish: fastFinish } = context.shape;
  const strongFinish = fastFinish || finish === 'accelerated';
  const faded = lateFade || pacing === 'significant_fade' || (pacing === 'mild_fade' && finish === 'faded');

  // A fade only leads the headline when the piece did not recover: a late dip
  // that ends in a strong finish is a kick, not a fade, so the more prominent
  // (and more alarming) "Faded through the back half" would misread it.
  if (faded && !strongFinish) return 'Faded through the back half';
  if (evenCore && strongFinish) return 'Controlled middle with a strong finish';
  if (pacing === 'negative_split' && strongFinish) return 'Built through the piece and finished strongly';
  if (pacing === 'even' && finish === 'even') return 'Even from start to finish';
  if (strongFinish) return 'Strong finish after a steady middle';
  if (pacing === 'negative_split') return 'Built pace through the second half';
  if (pacing === 'mild_fade') return 'A slight fade through the second half';
  if (pacing === 'variable') return 'Variable pacing across the piece';
  if (fastStart) return 'Fast opening before settling';
  if (finish === 'faded') return 'Pace eased at the finish';
  if (pacing && pacing !== 'unknown') return 'A controlled continuous row';

  return workout?.distance > 0
    ? `${formatDistance(workout.distance)} session complete`
    : 'Session complete';
}

// At most two sentences: the pacing story, then the single most useful
// supporting read (notable drift beats vs-typical beats rate). The client
// renders this verbatim, so length is controlled here, not by truncation.
function continuousSummary(workout, context, baseline) {
  const sentences = [];
  const story = pacingStory(context) ?? describeSessionOverview(workout);
  if (story) sentences.push(story);

  const drift = context.hrDriftPct;
  const supporting = (drift != null && Math.abs(drift) >= NOTABLE_HR_DRIFT_PCT ? describeDrift(drift) : null)
    ?? describeAgainstTypical(workout, baseline, context)[0]
    ?? describeRate(workout, context.rate);
  if (supporting) sentences.push(supporting);

  if (sentences.length === 0) return fallbackWorkoutSummary(workout);
  return sentences.join(' ');
}

// One sentence combining the opening, core and finish reads, e.g. "The opening
// was 1.8 s/500m quicker than the middle, pace held even through the core, and
// the finish accelerated."
function pacingStory(context) {
  const clauses = [];
  const start = findPhase(context.phases, 'start');
  const middle = findPhase(context.phases, 'middle');
  const startPace = positiveNumber(start?.avg_pace_ms);
  const middlePace = positiveNumber(middle?.avg_pace_ms);

  if (startPace && middlePace) {
    const difference = startPace - middlePace;
    const gapPct = (Math.abs(difference) / middlePace) * 100;
    if (gapPct > PHASE_PACE_EVEN_PCT && gapPct <= OPENING_STRUCTURE_CAP_PCT) {
      clauses.push(`the opening was ${(Math.abs(difference) / 1000).toFixed(1)} s/500m ${difference < 0 ? 'quicker' : 'slower'} than the middle`);
    }
  }

  const core = coreClause(context);
  if (core) clauses.push(core);
  const finish = finishClause(context);
  if (finish) clauses.push(finish);

  return sentenceFromClauses(clauses);
}

function coreClause(context) {
  const pacing = context.pacing?.value;
  if (context.shape.late_fade) return 'pace faded through the late stages';
  if (context.shape.even_core || pacing === 'even') return 'pace held even through the core';
  if (pacing === 'negative_split') return 'pace built through the second half';
  if (pacing === 'mild_fade') return 'pace eased slightly through the back half';
  if (pacing === 'significant_fade') return 'pace faded through the back half';
  if (pacing === 'variable') return 'pace varied through the middle';
  return null;
}

function finishClause(context) {
  const finish = context.finish?.value;
  if (context.shape.fast_finish || finish === 'accelerated') return 'the finish accelerated';
  if (finish === 'faded') return 'the finish eased';
  return null;
}

function sentenceFromClauses(clauses) {
  if (clauses.length === 0) return null;
  const joined = clauses.length === 1
    ? clauses[0]
    : `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

function intervalHeadline(workout, context) {
  const intervals = context.intervals ?? {};
  const repCount = positiveNumber(intervals.rep_count)
    ?? (Array.isArray(intervals.reps) ? intervals.reps.length : null);
  const degradation = finiteNumber(intervals.degradation_percent);
  const spread = finiteNumber(intervals.spread_percent);
  const fastestIndex = finiteNumber(intervals.fastest_rep_index);
  const finishedFastest = repCount != null && fastestIndex === repCount - 1;

  if (intervals.first_rep_fast && degradation != null && degradation > 1) {
    return 'Fast start, then a fade across the set';
  }
  if (degradation != null && degradation > 2) return 'Pace faded across the interval set';
  if (finishedFastest) return 'Finished the set with your fastest rep';
  if (degradation != null && degradation < -1) return 'Final rep was quicker than the first';
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

  // Same two-sentence budget as continuous pieces: the set story, then the
  // single most useful supporting read.
  if (repCount && spread != null && fastestIndex != null && fastestPace) {
    sentences.push(`Across ${repCount} work reps the pace spread was ${formatAbsPercent(spread)}, with rep ${fastestIndex + 1} fastest at ${formatPace(fastestPace)}/500m.`);
  } else if (repCount && spread != null) {
    sentences.push(`Across ${repCount} work reps, the fastest-to-slowest pace spread was ${formatAbsPercent(spread)}.`);
  } else if (fastestIndex != null && fastestPace) {
    sentences.push(`Rep ${fastestIndex + 1} was fastest at ${formatPace(fastestPace)}/500m.`);
  } else if (repCount) {
    sentences.push(`The session contained ${repCount} work reps.`);
  }

  const supporting = (finalPace && fastestPace && finalPace !== fastestPace
    ? `The final rep averaged ${formatPace(finalPace)}/500m.`
    : null)
    ?? describeAgainstTypical(workout, baseline, context)[0]
    ?? describeRate(workout, context.rate);
  if (supporting) sentences.push(supporting);

  if (sentences.length === 0) return fallbackWorkoutSummary(workout);
  return sentences.join(' ');
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

function describeAgainstTypical(workout, baseline, context = null) {
  const sentences = [];
  const workoutPace = positiveNumber(workout?.pace_ms);
  const medianPace = positiveNumber(baseline?.medianPaceMs);
  const workoutHr = positiveNumber(workout?.heart_rate_avg);
  const medianHr = positiveNumber(baseline?.medianHr);
  const tag = workout?.inferred_tag === 'interval' ? 'interval' : 'endurance';
  // A hard/maximal effort is a different kind of session from the endurance
  // days it would be measured against, so the comparison is dropped rather
  // than reporting an athlete is "15 s/500m faster than typical".
  const hardEffort = HARD_EFFORT_VALUES.has(context?.intensity?.value);
  // An endurance comparison only holds for endurance-length pieces; a short row
  // is not the same kind of session as the long steady rows in the median.
  const comparableLength = tag !== 'endurance'
    || (positiveNumber(workout?.distance) ?? 0) >= COMPARABLE_MIN_DISTANCE_M;

  const paceGap = workoutPace && medianPace ? Math.abs(workoutPace - medianPace) : null;
  if (
    paceGap != null && !hardEffort && comparableLength
    && paceGap >= TYPICAL_PACE_GAP_MS && paceGap <= COMPARABLE_MAX_PACE_GAP_MS
  ) {
    sentences.push(`${(paceGap / 1000).toFixed(1)} s/500m ${workoutPace < medianPace ? 'faster' : 'easier'} than your typical ${tag} session.`);
  }
  if (
    workoutPace && medianPace && workoutHr && medianHr && comparableLength
    && Math.abs(workoutPace - medianPace) <= COMPARABLE_PACE_GAP_MS
    && Math.abs(workoutHr - medianHr) >= TYPICAL_HR_GAP_BPM
  ) {
    sentences.push(`Average HR was about ${Math.round(Math.abs(workoutHr - medianHr))} bpm ${workoutHr < medianHr ? 'lower' : 'higher'} than usual at a comparable pace.`);
  }
  return sentences;
}

// Coaching is drawn from what the recording shows, not from a declared
// purpose. Each line describes the pacing shape and points at the one change
// that would sharpen it, so it never argues with the measured effort.
function recommendationFor(context) {
  if (context.isInterval) {
    const intervalRecommendation = recommendationForIntervals(context);
    if (intervalRecommendation) return intervalRecommendation;
  }

  const pacing = context.pacing?.value;
  const finish = context.finish?.value;
  const fastStart = context.shape.fast_start;
  const negativeSplit = pacing === 'negative_split';
  const strongFinish = context.shape.fast_finish || finish === 'accelerated';
  const faded = context.shape.late_fade || pacing === 'mild_fade' || pacing === 'significant_fade';
  const rateVariable = context.rate?.value === 'variable'
    || context.rate?.value === 'stable_avg_variable_stroke';
  const drift = context.hrDriftPct;
  const longPieceDrift = context.longPiece && drift != null && drift >= LONG_PIECE_DRIFT_PCT;
  const highDrift = drift != null && drift > HIGH_HR_DRIFT_PCT;
  const evenlyPaced = pacing === 'even' || negativeSplit || context.shape.even_core;

  if (fastStart && faded) {
    return 'The opening was quick and the pace faded through the back half, so holding back a little at the start would let you carry it further.';
  }
  if (faded) {
    return 'Pace faded through the back half, so settle a touch slower after the opening and it should hold to the finish.';
  }
  // On a long piece the power-to-HR decline is the durability signal worth
  // acting on, so it takes precedence over an end-of-piece kick.
  if (longPieceDrift) return driftRecommendation();
  if (strongFinish) return strongFinishRecommendation({ fastStart, negativeSplit, evenlyPaced });
  if (highDrift) return driftRecommendation();
  if (rateVariable) {
    return 'Smoothing out the stroke-to-stroke rate would sharpen an otherwise well-controlled row.';
  }
  if (evenlyPaced) {
    return 'Evenly controlled from start to finish, and a good one to repeat.';
  }
  return 'A controlled row. Keep the opening measured and the rhythm smooth to repeat it.';
}

function driftRecommendation() {
  return 'Heart rate crept up relative to output through the piece, so easing off a little earlier would keep effort and pace better coupled through the back half.';
}

// A strong finish is a common outcome, so the line is tailored to how the
// piece got there. Otherwise the same sentence repeats down the session list.
function strongFinishRecommendation({ fastStart, negativeSplit, evenlyPaced }) {
  if (negativeSplit) {
    return 'You built through the piece and still lifted the finish, so the pace could come up a little earlier next time.';
  }
  if (fastStart) {
    return 'You went out quick and still finished strong, so the middle had room to carry more pace.';
  }
  if (evenlyPaced) {
    return 'Controlled through the middle with plenty left for the finish, so the final drive could start a little earlier.';
  }
  return 'You finished with pace in hand, so there was room to start the final drive a little earlier.';
}

function recommendationForIntervals(context) {
  const intervals = context.intervals;
  if (!intervals) return null;

  const degradation = finiteNumber(intervals.degradation_percent);
  const spread = finiteNumber(intervals.spread_percent);
  const repCount = positiveNumber(intervals.rep_count);
  const fastestIndex = finiteNumber(intervals.fastest_rep_index);
  const wentOutHard = Boolean(intervals.first_rep_fast);
  const fadedAcross = degradation != null && degradation > 1;
  const built = degradation != null && degradation < -1;
  const evenSet = spread != null && spread <= 2;
  const finishedFastest = repCount != null && fastestIndex === repCount - 1;
  const fastestCameEarlier = repCount != null
    && fastestIndex != null
    && fastestIndex >= 0
    && fastestIndex < repCount - 1;
  const rateVariable = context.rate?.value === 'variable'
    || context.rate?.value === 'stable_avg_variable_stroke';

  if (wentOutHard && fadedAcross) {
    return 'The first rep was quick and the set faded from there, so a more even opening rep would let the closing reps hold pace.';
  }
  if (fadedAcross) {
    return 'The set faded rep to rep, so aim for a rep pace you can repeat all the way to the end.';
  }
  if (finishedFastest) {
    return 'You finished on your fastest rep, so the early reps had a little more to give.';
  }
  if (built) {
    return fastestCameEarlier
      ? 'The final rep beat the first, but the fastest work came earlier, so aim to carry that pace through to the finish.'
      : 'The set built rep to rep, so aim for a more even progression across it next time.';
  }
  if (evenSet) {
    return 'Rep pacing was tightly matched, so this is a good set to repeat.';
  }
  if (rateVariable) {
    return 'Smoothing the stroke-to-stroke rate across the reps would sharpen the set.';
  }
  return 'Keep the rep pacing even and the rhythm smooth to repeat this set.';
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
  const totalTenths = Math.round(paceMs / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function formatDistance(meters) {
  const rounded = Math.round(meters);
  if (rounded >= 1000 && rounded % 1000 === 0) return `${rounded / 1000} km`;
  return `${rounded.toLocaleString('en-GB')} m`;
}
