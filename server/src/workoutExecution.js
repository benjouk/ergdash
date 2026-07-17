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
// v2: observed effort is now HR-grounded (was pace-vs-benchmark only).
// v3: added the HR-drift (aerobic decoupling) read.
// v4: added data_quality (summary vs stroke-stream reconciliation).
// v5: added phase-based pacing shape, two-level rate stability, explicit
// HR-drift values, and estimated-zone metadata.
// v6: reads run on the scored piece when the stroke stream carries
// warmup/cooldown padding around it; phases carry absolute ranges.
// v7: piece windows tolerate paddling pauses before the piece.
// v8: windowed analyses also reconcile the scored piece separately from the
// full padded recording, so unrelated summary errors remain visible.
export const ANALYSIS_VERSION = 8;

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
const PACING_SHAPE_TOLERANCE_PCT = 1.0; // phase pace within ±1% of middle is neutral

const RATE_STABLE_SD_SPM = 1.5; // stroke-rate SD ≤ 1.5 spm reads as stable
// Average rate across five equal sections can be stable even when individual
// strokes fluctuate. Keep this distinct from the raw stroke-level threshold.
const RATE_PHASE_STABLE_SD_SPM = 1.5;

const FINISH_FRACTION = 0.08; // final 8% is "the finish"
const FINISH_PRECEDING_FRACTION = 0.25; // compared against the preceding 25%
const FINISH_DELTA_PCT = 1.0; // > 1% faster = accelerated, slower = faded

const EFFECTIVENESS_STABLE_TREND_PCT = 5.0; // |work/stroke trend| ≤ 5% = stable

const FIRST_REP_FAST_PCT = 2.0; // first rep > 2% faster than the mean = went out hard

// HR drift (aerobic decoupling): power-to-HR held (low) vs HR climbing (high).
const HR_DRIFT_LOW_PCT = 5; // ≤ 5% = coupled / good aerobic control
const HR_DRIFT_HIGH_PCT = 10; // > 10% = clearly decoupled

// Data-quality reconciliation: how far the workout's own summary fields
// (headline duration, average HR) are allowed to drift from what the stroke
// stream itself implies before the summary is flagged as unreliable.
const MIN_QUALITY_STROKES = 20;
const HR_MISMATCH_BPM = 3; // summary avg HR vs stroke-derived avg HR
const DURATION_MISMATCH_PCT = 1; // % of the summary duration
const DURATION_MISMATCH_MIN_S = 5; // floor so short pieces don't trip on rounding

// Scored-piece windowing: when the stroke stream clearly overshoots the
// summary (the warmup/cooldown-padding signature), the reads run on the
// contiguous stretch that matches the summary instead of the whole recording.
const WINDOW_DISTANCE_OVERSHOOT = 1.05; // stream must exceed summary distance by 5%
// Candidate windows are matched on average pace (duration over covered
// distance) against the summary's pace. Pace is scale-free, so a window that
// swaps piece metres for warmup metres cannot fake a match the way a raw
// duration comparison can.
const WINDOW_MATCH_PACE_PCT = 3;
// A window may cover fractionally less than the summary distance: recorded
// stroke odometers land a stroke-length short of round block boundaries, and
// demanding full coverage would force the window across a rest pause.
const WINDOW_DISTANCE_UNDERSHOOT_PCT = 0.5;

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

// Observed effort is HR-first: the time-weighted mean HR zone (1–5) maps to a
// band. Ordered easy→maximal so a weak signal can be capped rather than overstated.
const INTENSITY_ORDER = ['easy', 'moderate', 'hard', 'very_hard', 'maximal'];
const ZONE_INTENSITY_THRESHOLDS = [
  { max: 2.5, value: 'easy' },
  { max: 3.25, value: 'moderate' },
  { max: 4.0, value: 'hard' },
  { max: 4.6, value: 'very_hard' },
  { max: Infinity, value: 'maximal' },
];

// Continuous-workout phases as fractions of the piece (tunable). Sliced by
// distance for fixed-distance pieces and by time for fixed-time pieces.
const PHASE_BOUNDS = [
  { name: 'start', start: 0.0, end: 0.1 },
  { name: 'settle', start: 0.1, end: 0.25 },
  { name: 'middle', start: 0.25, end: 0.75 },
  { name: 'late', start: 0.75, end: 0.95 },
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

function sectionAverages(values, sectionCount) {
  const sections = Array.from({ length: sectionCount }, () => []);
  values.forEach((value, index) => {
    const section = Math.min(sectionCount - 1, Math.floor((index * sectionCount) / values.length));
    sections[section].push(value);
  });
  return sections.map(section => mean(section));
}

function phasePacesFromSamples(paceSamples) {
  return PHASE_BOUNDS.map(({ name, start, end }) => {
    const lo = Math.floor(start * paceSamples.length);
    const hi = end === 1 ? paceSamples.length : Math.floor(end * paceSamples.length);
    return { name, avg_pace_ms: mean(paceSamples.slice(lo, hi)) };
  });
}

function pacingShape(phases, fallbackLabel) {
  const phasePaces = Object.fromEntries(
    phases
      .filter(phase => phase?.avg_pace_ms > 0)
      .map(phase => [phase.name, phase.avg_pace_ms])
  );
  const middle = phasePaces.middle;
  if (!(middle > 0)) return null;

  const deltaPct = (name) => {
    const pace = phasePaces[name];
    return pace > 0 ? ((pace - middle) / middle) * 100 : null;
  };
  const startDelta = deltaPct('start');
  const settleDelta = deltaPct('settle');
  const lateDelta = deltaPct('late');
  const finishDelta = deltaPct('finish');
  const withinTolerance = delta => delta != null && Math.abs(delta) <= PACING_SHAPE_TOLERANCE_PCT;

  const fastStart = startDelta != null && startDelta < -PACING_SHAPE_TOLERANCE_PCT;
  const evenCore = withinTolerance(settleDelta) && withinTolerance(lateDelta);
  const lateFade = lateDelta != null && lateDelta > PACING_SHAPE_TOLERANCE_PCT;
  const fastFinish = finishDelta != null && finishDelta < -PACING_SHAPE_TOLERANCE_PCT;

  const labels = [];
  if (evenCore) labels.push('even core');
  if (lateFade) labels.push('late fade');
  if (fastStart && fastFinish) labels.push('fast start and finish');
  else if (fastStart) labels.push('fast start');
  else if (fastFinish) labels.push('fast finish');

  return {
    fast_start: fastStart,
    even_core: evenCore,
    late_fade: lateFade,
    fast_finish: fastFinish,
    shape_label: labels.join(', ') || fallbackLabel,
  };
}

// --- classifiers -------------------------------------------------------------

// Even / negative_split / mild_fade / significant_fade / variable, from
// first-half vs second-half pace plus intra-session variability.
export function classifyPacing(strokes = [], phases = null) {
  const p = paces(strokes);
  if (p.length < MIN_PACING_STROKES) {
    return unknown('Not enough pace samples to judge pacing.', { fade_percent: null, shape: null });
  }

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
    shape: pacingShape(
      Array.isArray(phases) && phases.length > 0 ? phases : phasePacesFromSamples(p),
      value.replaceAll('_', ' ')
    ),
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
    return unknown('Not enough stroke-rate samples to judge rate.', {
      average_spm: null,
      variation_spm: null,
      phase_variation_spm: null,
    });
  }
  const strokeSd = stddev(rates);
  const phaseSd = stddev(sectionAverages(rates, 5));
  const phaseStable = phaseSd <= RATE_PHASE_STABLE_SD_SPM;
  const strokeStable = strokeSd <= RATE_STABLE_SD_SPM;
  const value = phaseStable
    ? (strokeStable ? 'stable' : 'stable_avg_variable_stroke')
    : 'variable';
  return {
    value,
    average_spm: round(mean(rates)),
    variation_spm: round(strokeSd),
    phase_variation_spm: round(phaseSd),
    confidence: 0.9,
    basis: `Across five equal sections, average-rate variation was ${round(phaseSd)} spm (SD). Stroke-to-stroke variation was ${round(strokeSd)} spm (SD) around ${round(mean(rates))} spm.`,
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

// Aerobic decoupling: whether heart rate held steady against output (low drift)
// or climbed as the session wore on (high). Takes the already-computed drift %
// (null for intervals / sessions too short to be meaningful → unknown).
export function classifyHrDrift(hrDriftPct) {
  if (hrDriftPct == null || !Number.isFinite(hrDriftPct)) {
    return unknown('No aerobic-decoupling reading for this session.', { drift_percent: null });
  }
  let value = 'high';
  if (hrDriftPct <= HR_DRIFT_LOW_PCT) value = 'low';
  else if (hrDriftPct <= HR_DRIFT_HIGH_PCT) value = 'moderate';
  const driftPercent = round(hrDriftPct);
  return {
    value,
    drift_percent: driftPercent,
    confidence: 0.8,
    basis: driftPercent >= 0
      ? `Power-to-HR efficiency declined by ${driftPercent}% between the first and second halves (opening 10% and final 5% excluded).`
      : `Power-to-HR efficiency improved by ${Math.abs(driftPercent)}% between the first and second halves (opening 10% and final 5% excluded).`,
  };
}

function capIntensity(value, maxValue) {
  return INTENSITY_ORDER.indexOf(value) > INTENSITY_ORDER.indexOf(maxValue) ? maxValue : value;
}

// Observed *effort* — how hard the body worked — so heart rate is the primary
// signal: the time-weighted mean HR zone drives the band. Pace vs the athlete's
// best is only a capped fallback when no HR is available (pace alone can't
// establish a top-end effort, and a thin same-distance PB sample skews it).
//   zoneShares: length-5 array of time fractions per HR zone (or null)
//   zonesEstimated: true when max HR was inferred, not user-configured
export function classifyIntensity({ workout, benchmarkPaceMs, zoneShares, zonesEstimated } = {}) {
  if (Array.isArray(zoneShares) && zoneShares.length === 5) {
    const total = zoneShares.reduce((s, v) => s + (v > 0 ? v : 0), 0);
    if (total > 0) {
      const shares = zoneShares.map(v => (v > 0 ? v : 0) / total);
      const weighted = shares.reduce((s, share, i) => s + (i + 1) * share, 0);
      const dominant = shares.indexOf(Math.max(...shares)) + 1;
      let value = ZONE_INTENSITY_THRESHOLDS.find(t => weighted < t.max).value;
      let confidence = 0.7;
      if (zonesEstimated) {
        // Estimated max HR compresses the zones, so don't overstate the top end.
        value = capIntensity(value, 'hard');
        confidence = 0.55;
      }
      return {
        value,
        confidence,
        estimated: Boolean(zonesEstimated),
        dominant_zone: dominant,
        basis: `Most of the session was in HR zone ${dominant}${zonesEstimated ? ' (max HR estimated)' : ''}.`,
      };
    }
  }

  const pace = workout?.pace_ms;
  if (pace > 0 && benchmarkPaceMs > 0) {
    const pacePct = benchmarkPaceMs / pace; // ≤ 1; closer to 1 = nearer the PB
    const band = INTENSITY_BANDS.find(b => pacePct >= b.min) ?? INTENSITY_BANDS[INTENSITY_BANDS.length - 1];
    return {
      value: capIntensity(band.value, 'hard'),
      confidence: 0.5,
      estimated: false,
      dominant_zone: null,
      basis: `Pace was ${round(pacePct * 100)}% of your best at this distance (no heart-rate data).`,
    };
  }

  return unknown('No heart-rate or benchmark data, so effort can’t be placed.', {
    estimated: false,
    dominant_zone: null,
  });
}

// Finds the scored piece inside a stroke stream that carries extra recording
// around it (warmup/cooldown padding is the common Concept2 shape: summary
// says 2,000m / 7:00 while the stream spans 4,000m / 17:00). Looks for the
// contiguous stretch covering the summary distance whose duration best
// matches the summary time; only trims when the stream clearly overshoots the
// summary AND a stretch matches it closely, so a genuinely mismatched summary
// is never "fixed" by inventing a window. Returns { strokes, window } where
// window is null when no trimming happened.
export function locateScoredPiece(workout, strokes = []) {
  const noWindow = { strokes, window: null };
  const targetDistance = workout?.distance;
  const targetDurationS = workout?.time_ms > 0 ? workout.time_ms / 1000 : null;
  if (!(targetDistance > 0) || !(targetDurationS > 0)) return noWindow;

  const usable = strokes.filter(s => s?.distance_m >= 0 && s?.time_s >= 0);
  if (usable.length < MIN_QUALITY_STROKES) return noWindow;

  const streamDistance = usable[usable.length - 1].distance_m - usable[0].distance_m;
  const streamDurationS = usable[usable.length - 1].time_s - usable[0].time_s;
  const durationTolerance = Math.max(DURATION_MISMATCH_MIN_S, targetDurationS * (DURATION_MISMATCH_PCT / 100));
  if (streamDistance < targetDistance * WINDOW_DISTANCE_OVERSHOOT
    || streamDurationS <= targetDurationS + durationTolerance) {
    return noWindow;
  }

  // A stroke's own rowing time, from its pace and the distance it covered.
  // Used to reconstruct where a window's first stroke actually began, so a
  // paddling pause recorded before the piece never counts into its duration.
  const strokeStartTime = (idx) => {
    const stroke = usable[idx];
    const prevD = idx > 0 ? usable[idx - 1].distance_m : 0;
    const prevT = idx > 0 ? usable[idx - 1].time_s : 0;
    const dist = stroke.distance_m - prevD;
    const rowedS = stroke.pace_ms > 0 && dist > 0 ? (stroke.pace_ms / 1000) * (dist / 500) : null;
    // Clamp to the previous stroke's clock: the stroke cannot have started
    // before the previous one ended.
    return rowedS != null ? Math.max(prevT, stroke.time_s - rowedS) : prevT;
  };

  // Two-pointer sweep over [s, j]: for each candidate first stroke s, the
  // shortest span covering the summary distance, keeping the span whose
  // duration best matches the summary time. Assumes distance_m and time_s are
  // cumulative and monotonic.
  const requiredDistance = targetDistance * (1 - WINDOW_DISTANCE_UNDERSHOOT_PCT / 100);
  const targetPace = targetDurationS / targetDistance; // s per metre
  let best = null;
  let j = 0;
  for (let s = 0; s < usable.length; s++) {
    const originD = s > 0 ? usable[s - 1].distance_m : 0;
    if (j < s) j = s;
    while (j < usable.length && usable[j].distance_m - originD < requiredDistance) j++;
    if (j >= usable.length) break;
    const originT = strokeStartTime(s);
    // Consider both the shortest qualifying window and the one covering the
    // full summary distance (when it exists); full coverage wins ties, so the
    // undershoot allowance never trims a window unnecessarily.
    let jFull = j;
    while (jFull < usable.length && usable[jFull].distance_m - originD < targetDistance) jFull++;
    const ends = jFull < usable.length && jFull !== j ? [jFull, j] : [j];
    for (const end of ends) {
      const durationS = usable[end].time_s - originT;
      const covered = usable[end].distance_m - originD;
      const paceDiff = Math.abs(durationS / covered - targetPace) / targetPace;
      if (!best || paceDiff < best.paceDiff - 1e-9) {
        best = { s, j: end, originD, originT, paceDiff, durationS };
      }
    }
  }

  if (!best || best.paceDiff > WINDOW_MATCH_PACE_PCT / 100) return noWindow;

  // Strokes s..j were rowed inside the piece. Rebase their clocks/odometers to
  // the piece origin so every downstream consumer treats the window as a piece
  // starting from zero.
  const windowStrokes = usable.slice(best.s, best.j + 1).map(s => ({
    ...s,
    distance_m: s.distance_m - best.originD,
    time_s: s.time_s - best.originT,
  }));
  if (windowStrokes.length < MIN_QUALITY_STROKES) return noWindow;

  return {
    strokes: windowStrokes,
    window: {
      start_distance_m: Math.round(best.originD),
      end_distance_m: Math.round(usable[best.j].distance_m),
      start_time_s: round(best.originT, 0),
      end_time_s: round(usable[best.j].time_s, 0),
      stroke_count: windowStrokes.length,
      total_stroke_count: strokes.length,
      stream_distance_m: Math.round(streamDistance),
      stream_duration_s: round(streamDurationS, 0),
      basis: `The recording spans ${Math.round(streamDistance).toLocaleString('en-GB')}m; the reads use the ${Math.round(targetDistance).toLocaleString('en-GB')}m stretch that matches the session summary.`,
    },
  };
}

// Reconciliation: does the workout's own summary (headline duration, average
// HR) agree with what its stroke stream implies? Real devices compute both
// from the same recording, so a real disagreement usually means the summary
// was edited or imported separately from the stroke data, or the stroke
// stream covers more than the summary describes (e.g. warmup/cooldown padding
// around a scored piece). Every read above already derives from the stroke
// stream directly rather than these summary fields, so a reconciliation
// failure here is a flag on the *summary* fields — the reads elsewhere in
// this analysis stay valid.
//
// Duration is only checked for continuous pieces: an interval workout's
// time_ms is work time only, while the stroke clock may or may not span the
// rest gaps between reps, so "stream span vs summary duration" isn't a
// like-for-like comparison there.
export function assessDataQuality(workout, strokes = [], { isInterval = false } = {}) {
  const issues = [];

  const hrs = strokes.map(s => s?.heart_rate).filter(h => h > 0);
  if (hrs.length >= MIN_QUALITY_STROKES && workout?.heart_rate_avg > 0) {
    const strokeAvgHr = mean(hrs);
    if (Math.abs(strokeAvgHr - workout.heart_rate_avg) >= HR_MISMATCH_BPM) {
      issues.push({
        field: 'heart_rate_avg',
        summary_value: workout.heart_rate_avg,
        derived_value: round(strokeAvgHr, 0),
        message: `Summary average HR is ${workout.heart_rate_avg} bpm; the stroke stream averages ${round(strokeAvgHr, 0)} bpm.`,
      });
    }
  }

  const timed = strokes.filter(s => s?.time_s >= 0);
  if (!isInterval && timed.length >= MIN_QUALITY_STROKES && workout?.time_ms > 0) {
    const strokeDurationS = timed[timed.length - 1].time_s - timed[0].time_s;
    const summaryDurationS = workout.time_ms / 1000;
    const diffS = strokeDurationS - summaryDurationS;
    const tolerance = Math.max(DURATION_MISMATCH_MIN_S, summaryDurationS * (DURATION_MISMATCH_PCT / 100));
    if (Math.abs(diffS) > tolerance) {
      issues.push({
        field: 'time_ms',
        summary_value: workout.time_ms,
        derived_value: Math.round(strokeDurationS * 1000),
        message: `Summary duration is ${round(summaryDurationS)}s; the stroke stream spans ${round(strokeDurationS)}s (${round(Math.abs(diffS))}s difference).`,
      });
    }
  }

  return { reconciled: issues.length === 0, issues };
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
    // Absolute range of the phase in the sliced axis, so the client never has
    // to reconstruct it from percentages and a possibly-different total.
    const range = byTime
      ? { start_s: Math.round(lo), end_s: Math.round(hi) }
      : { start_m: Math.round(lo), end_m: Math.round(hi) };
    return {
      name,
      start_pct: Math.round(start * 100),
      end_pct: Math.round(end * 100),
      ...range,
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
  zoneShares = null,
  zonesEstimated = false,
  hrDriftPct = null,
  // The untrimmed stream, when `strokes` was windowed to the scored piece.
  // Reconciliation always judges the summary against the full recording.
  fullStrokes = null,
  analysisWindow = null,
}) {
  const isInterval = structure?.value === 'interval';
  const phases = isInterval ? [] : computePhases(workout, strokes);
  const dataQuality = assessDataQuality(workout, fullStrokes ?? strokes, { isInterval });

  // A padded recording is expected not to reconcile with a summary that only
  // describes its scored piece. Keep that full-stream result, but also judge
  // the summary against the selected piece so a genuinely incorrect HR/time
  // summary is not hidden by the otherwise-successful window match.
  if (analysisWindow) {
    dataQuality.scored_piece = assessDataQuality(workout, strokes, { isInterval });
  }

  const rate = rateStability(strokes);
  if (rateDisciplinePct != null) rate.discipline_pct = round(rateDisciplinePct, 0);

  const execution = {
    intensity: classifyIntensity({ workout, benchmarkPaceMs, zoneShares, zonesEstimated }),
    pacing: isInterval ? null : classifyPacing(strokes, phases),
    rate,
    finish: isInterval ? null : analyzeFinish(strokes),
    stroke_effectiveness: strokeEffectiveness(workout, strokes),
    hr_drift: classifyHrDrift(hrDriftPct),
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
    data_quality: dataQuality,
    analysis_window: analysisWindow,
    phases,
    intervals: isInterval ? analyzeIntervals(intervals) : null,
  };
}
