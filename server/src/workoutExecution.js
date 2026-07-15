// Observed-execution analysis: turns raw stroke/interval data into categorized,
// explainable, versioned "what happened" facts (intensity, pacing, rate, finish,
// stroke effectiveness) plus per-phase (continuous) or per-rep (interval) detail.
//
// Everything here is a pure function: data in, tagged result out, no DB. Each
// classifier returns { value, confidence, basis } and yields 'unknown' rather
// than guessing when the data is insufficient. All thresholds are named
// constants. Statements stay grounded in pace/power/rate/HR only — no stroke
// geometry / technique claims (there are no force-curve sensors here).

import { wattsFromPace } from './strokeMetrics.js';

// Bump when any formula below changes so computeAllMetrics recomputes cached
// analyses. Kept here (not analytics.js) since it versions this module's logic.
export const ANALYSIS_VERSION = 1;

// --- thresholds (named so behaviour is easy to tune) -------------------------
const MIN_PACING_STROKES = 8;
const MIN_RATE_STROKES = 20;
const MIN_PHASE_STROKES = 12;
const MIN_EFFECTIVENESS_STROKES = 8;

// pacing: fade_percent = (2nd-half pace − 1st-half pace) / 1st-half pace × 100.
// pace_ms is per-500m, so a higher value is slower → positive fade = slowing.
const PACING_EVEN_PCT = 1.0; // |fade| ≤ 1% reads as even
const PACING_MILD_FADE_PCT = 3.0; // 1–3% slower = mild fade, > 3% = significant
const PACING_NEG_SPLIT_PCT = -1.0; // ≥ 1% faster in the back half = negative split
const PACING_VARIABLE_CV = 0.05; // pace CV above this, with no clear trend = variable

const RATE_STABLE_SD_SPM = 1.5; // stroke-rate SD ≤ 1.5 spm reads as stable

const FINISH_FRACTION = 0.08; // final 8% is "the finish"
const FINISH_PRECEDING_FRACTION = 0.25; // compared against the preceding 25%
const FINISH_DELTA_PCT = 1.0; // > 1% faster = accelerated, slower = faded

const EFFECTIVENESS_STABLE_TREND_PCT = 5.0; // |work/stroke trend| ≤ 5% = stable

const FIRST_REP_FAST_PCT = 2.0; // first rep > 2% faster than the mean = went out hard

// Observed intensity by pace vs the athlete's own best at this distance
// (pacePct = best / this, ≤ 1; closer to 1 = harder). Bands are intentionally
// coarse and only used when a personal benchmark exists.
const INTENSITY_BANDS = [
  { min: 0.97, value: 'maximal' },
  { min: 0.93, value: 'very_hard' },
  { min: 0.87, value: 'hard' },
  { min: 0.78, value: 'moderate' },
  { min: 0, value: 'easy' },
];

// Continuous-workout phases as fractions of the piece (tunable). Sliced by
// distance for fixed-distance pieces and by time for fixed-time pieces.
const PHASE_BOUNDS = [
  { name: 'start', start: 0.0, end: 0.1 },
  { name: 'settle', start: 0.1, end: 0.25 },
  { name: 'middle', start: 0.25, end: 0.75 },
  { name: 'pressure', start: 0.75, end: 0.95 },
  { name: 'finish', start: 0.95, end: 1.0 },
];

// --- small pure helpers ------------------------------------------------------
function mean(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  if (m == null) return null;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function round(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function strokeWatts(stroke) {
  if (stroke?.watts > 0) return stroke.watts;
  return wattsFromPace(stroke?.pace_ms);
}

function paces(strokes) {
  return strokes.map(s => s?.pace_ms).filter(p => p > 0);
}

function unknown(basis, extra = {}) {
  return { value: 'unknown', confidence: 0, basis, ...extra };
}

// --- classifiers -------------------------------------------------------------

// Even / negative_split / mild_fade / significant_fade / variable, from
// first-half vs second-half pace plus intra-session variability.
export function classifyPacing(strokes = []) {
  const p = paces(strokes);
  if (p.length < MIN_PACING_STROKES) return unknown('Not enough pace samples to judge pacing.', { fade_percent: null });

  const half = Math.floor(p.length / 2);
  const firstAvg = mean(p.slice(0, half));
  const secondAvg = mean(p.slice(half));
  const fade = ((secondAvg - firstAvg) / firstAvg) * 100;

  // Quartile monotonicity: a clean trend (steadily fading or negative-splitting)
  // is not "variable" however wide it is; choppiness with no trend is.
  const q = Math.floor(p.length / 4);
  const qAvgs = [0, 1, 2, 3].map(i => mean(p.slice(i * q, i === 3 ? p.length : (i + 1) * q)));
  const monotonicUp = qAvgs.every((v, i) => i === 0 || v >= qAvgs[i - 1]);
  const monotonicDown = qAvgs.every((v, i) => i === 0 || v <= qAvgs[i - 1]);
  const cv = stddev(p) / mean(p);

  let value;
  if (cv > PACING_VARIABLE_CV && !monotonicUp && !monotonicDown) {
    value = 'variable';
  } else if (fade <= PACING_NEG_SPLIT_PCT) {
    value = 'negative_split';
  } else if (Math.abs(fade) <= PACING_EVEN_PCT) {
    value = 'even';
  } else if (fade <= PACING_MILD_FADE_PCT) {
    value = 'mild_fade';
  } else {
    value = 'significant_fade';
  }

  const confidence = p.length >= 4 * MIN_PACING_STROKES ? 0.9 : 0.7;
  return {
    value,
    fade_percent: round(fade),
    confidence,
    basis: value === 'variable'
      ? `Pace varied ${round(cv * 100)}% around the average without a clear trend.`
      : `Second-half pace was ${round(Math.abs(fade))}% ${fade > 0 ? 'slower' : 'faster'} than the first half.`,
  };
}

// Stable / variable stroke rate from its standard deviation. Distinct from
// rate *discipline* (holding a target band) — this is raw steadiness.
export function rateStability(strokes = []) {
  const rates = strokes.map(s => s?.stroke_rate).filter(r => r > 0);
  if (rates.length < MIN_RATE_STROKES) {
    return unknown('Not enough stroke-rate samples to judge rate.', { average_spm: null, variation_spm: null });
  }
  const sd = stddev(rates);
  return {
    value: sd <= RATE_STABLE_SD_SPM ? 'stable' : 'variable',
    average_spm: round(mean(rates)),
    variation_spm: round(sd),
    confidence: 0.9,
    basis: `Stroke rate held within ${round(sd)} spm (SD) of an average of ${round(mean(rates))} spm.`,
  };
}

// Accelerated / faded / even over the final stretch vs the preceding stretch.
export function analyzeFinish(strokes = []) {
  const p = paces(strokes);
  if (p.length < MIN_PACING_STROKES) return unknown('Not enough pace samples to judge the finish.');

  const finishStart = Math.floor(p.length * (1 - FINISH_FRACTION));
  const precedingStart = Math.floor(p.length * (1 - FINISH_FRACTION - FINISH_PRECEDING_FRACTION));
  const finish = mean(p.slice(finishStart));
  const preceding = mean(p.slice(precedingStart, finishStart));
  if (finish == null || preceding == null || !(preceding > 0)) {
    return unknown('Not enough pace samples to compare the finish.');
  }

  const delta = ((finish - preceding) / preceding) * 100; // + = slower at the end
  let value = 'even';
  if (delta <= -FINISH_DELTA_PCT) value = 'accelerated';
  else if (delta >= FINISH_DELTA_PCT) value = 'faded';

  return {
    value,
    confidence: 0.8,
    basis: `Final ${Math.round(FINISH_FRACTION * 100)}% was ${round(Math.abs(delta))}% ${delta < 0 ? 'faster' : 'slower'} than the preceding stretch.`,
  };
}

// Work per stroke (J) and its first-half → second-half trend. Needs power (or
// pace to derive it) and stroke rate.
export function strokeEffectiveness(workout, strokes = []) {
  const usable = strokes
    .map(s => ({ w: strokeWatts(s), r: s?.stroke_rate }))
    .filter(x => x.w > 0 && x.r > 0);

  const wps = (rows) => {
    const w = mean(rows.map(x => x.w));
    const r = mean(rows.map(x => x.r));
    return w != null && r > 0 ? (w * 60) / r : null;
  };

  if (usable.length < MIN_EFFECTIVENESS_STROKES) {
    // Fall back to a single point value from workout aggregates, no trend.
    const w = wattsFromPace(workout?.pace_ms);
    const r = workout?.stroke_rate;
    if (w > 0 && r > 0) {
      return {
        value: 'unknown',
        work_per_stroke_joules: round((w * 60) / r, 0),
        trend_percent: null,
        confidence: 0.3,
        basis: 'Work per stroke estimated from session averages; no stroke stream for a trend.',
      };
    }
    return unknown('No power/rate data to compute work per stroke.', { work_per_stroke_joules: null, trend_percent: null });
  }

  const half = Math.floor(usable.length / 2);
  const wps1 = wps(usable.slice(0, half));
  const wps2 = wps(usable.slice(half));
  const overall = wps(usable);
  const trend = wps1 > 0 ? ((wps2 - wps1) / wps1) * 100 : null;

  return {
    value: trend != null && Math.abs(trend) <= EFFECTIVENESS_STABLE_TREND_PCT ? 'stable' : 'variable',
    work_per_stroke_joules: round(overall, 0),
    trend_percent: round(trend),
    confidence: 0.7,
    basis: trend != null
      ? `Work per stroke changed ${round(Math.abs(trend))}% from the first half to the second.`
      : `Averaged ${round(overall, 0)} J per stroke.`,
  };
}

// Observed intensity, cautiously: pace vs the athlete's best at this distance.
// No personal benchmark → unknown (absolute numbers alone don't establish effort).
export function classifyIntensity({ workout, benchmarkPaceMs } = {}) {
  const pace = workout?.pace_ms;
  if (!(pace > 0) || !(benchmarkPaceMs > 0)) {
    return unknown('No personal benchmark at this distance yet, so effort can’t be placed.');
  }
  const pacePct = benchmarkPaceMs / pace; // ≤ 1; closer to 1 = nearer the PB = harder
  const band = INTENSITY_BANDS.find(b => pacePct >= b.min) ?? INTENSITY_BANDS[INTENSITY_BANDS.length - 1];
  return {
    value: band.value,
    confidence: 0.7,
    basis: `Pace was ${round(pacePct * 100)}% of your best at this distance.`,
  };
}

// Continuous-workout phase breakdown. Slices strokes by distance (fixed-distance)
// or time (fixed-time) into the configured phases and averages each channel.
export function computePhases(workout, strokes = []) {
  if (strokes.length < MIN_PHASE_STROKES) return [];

  const byTime = /FixedTime/.test(workout?.workout_type || '');
  const pos = (s) => (byTime ? s?.time_s : s?.distance_m);
  const last = strokes[strokes.length - 1];
  const total = pos(last);
  if (!(total > 0)) return [];

  return PHASE_BOUNDS.map(({ name, start, end }) => {
    const lo = start * total;
    const hi = end * total;
    const seg = strokes.filter(s => {
      const x = pos(s);
      return x != null && x >= lo && (end === 1 ? x <= hi : x < hi);
    });
    const rate = mean(seg.map(s => s?.stroke_rate).filter(r => r > 0));
    const watts = mean(seg.map(s => strokeWatts(s)).filter(w => w > 0));
    return {
      name,
      start_pct: Math.round(start * 100),
      end_pct: Math.round(end * 100),
      avg_pace_ms: round(mean(seg.map(s => s?.pace_ms).filter(p => p > 0)), 0),
      avg_power: round(watts, 0),
      avg_rate: round(rate),
      avg_hr: round(mean(seg.map(s => s?.heart_rate).filter(h => h > 0)), 0),
      work_per_stroke: watts > 0 && rate > 0 ? round((watts * 60) / rate, 0) : null,
    };
  });
}

// Interval rep analysis: fastest/slowest, rep-to-rep degradation, went-out-hard
// detection, final-rep and consistency. Uses interval-row paces directly (does
// NOT apply continuous fade formulas — source-doc §9).
export function analyzeIntervals(intervals = []) {
  const work = intervals
    .filter(iv => iv?.type !== 'rest')
    .map(iv => (iv.pace_ms > 0
      ? iv.pace_ms
      : (iv.distance > 0 && iv.time_ms > 0 ? Math.round((iv.time_ms / iv.distance) * 500) : null)))
    .filter(p => p > 0);

  if (work.length < 2) return null;

  const fastest = Math.min(...work);
  const slowest = Math.max(...work);
  const avg = mean(work);
  const first = work[0];
  const finalRep = work[work.length - 1];
  const spread = ((slowest - fastest) / fastest) * 100;
  const degradation = ((finalRep - first) / first) * 100; // + = slowed across the set
  const cv = stddev(work) / avg;

  return {
    rep_count: work.length,
    fastest_rep_index: work.indexOf(fastest),
    slowest_rep_index: work.indexOf(slowest),
    fastest_pace_ms: fastest,
    slowest_pace_ms: slowest,
    final_rep_pace_ms: finalRep,
    spread_percent: round(spread),
    degradation_percent: round(degradation),
    first_rep_fast: first < avg * (1 - FIRST_REP_FAST_PCT / 100),
    consistency: round(Math.max(0, Math.min(100, 100 - cv * 500)), 0),
    confidence: 0.85,
    basis: `Across ${work.length} reps the spread was ${round(spread)}% fastest-to-slowest.`,
  };
}

// Compose the full versioned analysis object. Continuous pieces get pacing/
// finish/phases; interval pieces get the rep analysis instead (§9 keeps fade
// formulas off intervals). Rate discipline is passed in (already computed by the
// caller) so we don't recompute it.
export function buildWorkoutAnalysis({
  workout,
  strokes = [],
  intervals = [],
  structure,
  benchmarkPaceMs = null,
  rateDisciplinePct = null,
}) {
  const isInterval = structure?.value === 'interval';

  const rate = rateStability(strokes);
  if (rateDisciplinePct != null) rate.discipline_pct = round(rateDisciplinePct, 0);

  const execution = {
    intensity: classifyIntensity({ workout, benchmarkPaceMs }),
    pacing: isInterval ? null : classifyPacing(strokes),
    rate,
    finish: isInterval ? null : analyzeFinish(strokes),
    stroke_effectiveness: strokeEffectiveness(workout, strokes),
  };

  return {
    version: ANALYSIS_VERSION,
    structure: structure
      ? {
        value: structure.value,
        subtype: structure.subtype,
        confidence: structure.confidence,
        reasons: structure.reasons,
      }
      : null,
    execution,
    phases: isInterval ? [] : computePhases(workout, strokes),
    intervals: isInterval ? analyzeIntervals(intervals) : null,
  };
}
