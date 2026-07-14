import { describe, expect, it } from 'vitest';
import {
  buildComparisonSplits, buildComparisonSummary, buildMetricSeries, buildRacePlayback,
  buildSoloRacePlayback, comparisonMetricCards, normalizeComparisonWorkout, sampleRacePlayback,
} from './workoutComparison.js';

const workout = (overrides = {}) => ({
  distance: 2000, time_ms: 480000, pace_ms: 120000, heart_rate_avg: 160,
  strokes: Array.from({ length: 20 }, (_, index) => ({
    distance_m: index * 100, time_s: index * 24, pace_ms: 120000, stroke_rate: 28, heart_rate: 160,
  })), intervals: [], ...overrides,
});

const strokesAtPace = (paceMs, { rate = 28, hr = 160 } = {}) => Array.from({ length: 20 }, (_, index) => ({
  distance_m: index * 100, time_s: index * (paceMs / 1000) / 5, pace_ms: paceMs, stroke_rate: rate, heart_rate: hr,
}));

// A recording the way FIT imports arrive: the odometer and clock span the
// whole outing (warmup + scored piece + cooldown) while the workout totals
// describe the 2,000m piece only.
function odometerWorkout(overrides = {}) {
  const strokes = [];
  let distance = 0;
  let time = 0;
  const block = (blockDistance, paceMs, hr) => {
    for (let covered = 0; covered < blockDistance; covered += 50) {
      strokes.push({ distance_m: distance, time_s: time, pace_ms: paceMs, stroke_rate: 26, heart_rate: hr });
      distance += 50;
      time += (50 / 500) * (paceMs / 1000);
    }
  };
  block(1200, 150000, 120); // warmup
  block(2000, 120000, 165); // scored piece: 480s total
  block(600, 160000, 130); // cooldown
  return { distance: 2000, time_ms: 480000, pace_ms: 120000, heart_rate_avg: 165, strokes, intervals: [], ...overrides };
}

describe('normalizeComparisonWorkout', () => {
  it('trims warmup and cooldown by locating the scored piece in the odometer stream', () => {
    const normalized = normalizeComparisonWorkout(odometerWorkout());
    const strokes = normalized.strokes;
    expect(strokes[0].distance_m).toBe(0);
    expect(strokes.at(-1).distance_m).toBeLessThanOrEqual(2000);
    expect(strokes.at(-1).distance_m).toBeGreaterThan(1900);
    // No warmup pace inside the piece
    expect(strokes.filter(s => s.distance_m < 2000).every(s => s.pace_ms === 120000)).toBe(true);
    expect(strokes[0].time_s).toBe(0);
  });

  it('shifts constant-offset recordings back to zero', () => {
    const contaminated = workout({
      strokes: Array.from({ length: 20 }, (_, index) => ({
        distance_m: 5000 + index * 100, time_s: 3000 + index * 24, pace_ms: 120000, stroke_rate: 28, heart_rate: 160,
      })),
    });
    const normalized = normalizeComparisonWorkout(contaminated);
    expect(normalized.strokes[0].distance_m).toBe(0);
    expect(normalized.strokes[0].time_s).toBe(0);
    expect(normalized.strokes.at(-1).distance_m).toBe(1900);
  });

  it('leaves clean recordings unchanged and memoizes per workout object', () => {
    const clean = workout();
    const normalized = normalizeComparisonWorkout(clean);
    expect(normalized.strokes.map(s => s.distance_m)).toEqual(clean.strokes.map(s => s.distance_m));
    expect(normalizeComparisonWorkout(clean)).toBe(normalized);
  });

  it('maps interval work strokes onto a cumulative work-only axis', () => {
    const intervals = [
      { interval_index: 0, type: 'work', distance: 500, time_ms: 100000, pace_ms: 100000, stroke_rate: 30, heart_rate_avg: 170 },
      { interval_index: 1, type: 'rest', distance: 100, time_ms: 60000 },
      { interval_index: 2, type: 'work', distance: 500, time_ms: 102000, pace_ms: 102000, stroke_rate: 30, heart_rate_avg: 175 },
      { interval_index: 3, type: 'rest', distance: 100, time_ms: 60000 },
    ];
    // Strokes recorded for work only, but the odometer accumulates rest metres:
    // rep 2 starts at 600m instead of 500m.
    const strokes = [];
    let time = 0;
    const rep = (startDistance, paceMs) => {
      for (let k = 0; k < 10; k++) {
        strokes.push({ distance_m: startDistance + k * 50, time_s: time, pace_ms: paceMs, stroke_rate: 30, heart_rate: 170 });
        time += 10;
      }
    };
    rep(0, 100000);
    time += 60;
    rep(600, 102000);
    const contaminated = { distance: 1000, time_ms: 202000, pace_ms: 101000, inferred_tag: 'interval', strokes, intervals };

    const normalized = normalizeComparisonWorkout(contaminated);
    expect(normalized.strokes).toHaveLength(20);
    const rep2 = normalized.strokes.filter(s => s.pace_ms === 102000);
    expect(rep2.every(s => s.distance_m >= 500 && s.distance_m < 1000)).toBe(true);
    expect(normalized.strokes.every(s => s.distance_m >= 0 && s.distance_m < 1000)).toBe(true);
  });
});

describe('workout comparison analysis', () => {
  it('normalizes unlike sessions onto percentage completed', () => {
    const result = buildMetricSeries(workout(), workout({ distance: 5000 }), 'pace', 'percent');
    expect(result.axis).toBe('percent');
    expect(result.data).toHaveLength(50);
  });

  it('caps the distance axis at the scored piece, not the raw recording', () => {
    const result = buildMetricSeries(odometerWorkout(), workout(), 'pace', 'distance');
    expect(result.axis).toBe('distance');
    expect(result.data.at(-1).x).toBeLessThanOrEqual(2000);
    // First bucket reflects piece pace, not warmup paddling
    expect(result.data[0].value1).toBeCloseTo(120000, -3);
  });

  it('aligns work intervals while ignoring rests', () => {
    const intervals = [
      { type: 'work', pace_ms: 110000 }, { type: 'rest', pace_ms: 300000 }, { type: 'work', pace_ms: 112000 },
    ];
    const rows = buildComparisonSplits(workout({ intervals }), workout({ intervals }), { axis: 'distance' });
    expect(rows.map(row => row.label)).toEqual(['Rep 1', 'Rep 2']);
  });

  it('builds sane splits from an odometer-contaminated recording', () => {
    const rows = buildComparisonSplits(odometerWorkout(), workout({ strokes: strokesAtPace(125000) }), { level: 'exact', axis: 'distance' });
    expect(rows.map(row => row.label)).toEqual(['0-500m', '500-1000m', '1000-1500m', '1500-2000m']);
    for (const row of rows) {
      expect(row.pace1_ms).toBeCloseTo(120000, -3);
      expect(row.pace_delta_ms).toBeCloseTo(-5000, -3);
    }
  });

  it('accumulates the cumulative gap across like-for-like splits', () => {
    const rows = buildComparisonSplits(workout(), workout({ strokes: strokesAtPace(122000) }), { level: 'exact', axis: 'distance' });
    expect(rows.map(row => row.gap_s)).toEqual([-2, -4, -6, -8]);
  });

  it('omits the gap for percent-axis comparisons', () => {
    const rows = buildComparisonSplits(workout(), workout({ distance: 5000 }), { level: 'other', axis: 'percent' });
    expect(rows.every(row => row.gap_s == null)).toBe(true);
  });

  it('populates first/second half even when this session is faster everywhere', () => {
    const splits = buildComparisonSplits(odometerWorkout(), workout({ strokes: strokesAtPace(125000) }), { level: 'exact', axis: 'distance' });
    const summary = buildComparisonSummary(odometerWorkout(), workout({ strokes: strokesAtPace(125000) }), { level: 'exact', axis: 'distance' }, splits);
    expect(summary.where.firstHalf).toMatch(/^-/);
    expect(summary.where.secondHalf).toMatch(/^-/);
    expect(summary.where.strongest).toBeTruthy();
    expect(summary.where.strongestDelta).toMatch(/^-/);
    expect(summary.where.weakestDelta).toMatch(/^-/);
  });

  it('describes each session\'s pacing shape', () => {
    const faded = workout({
      strokes: Array.from({ length: 20 }, (_, index) => ({
        distance_m: index * 100, time_s: index * 24,
        pace_ms: index < 10 ? 118000 : 124000, stroke_rate: 28, heart_rate: 160,
      })),
    });
    const summary = buildComparisonSummary(faded, workout(), { level: 'exact', axis: 'distance' }, []);
    expect(summary.pacing).toContain('This session faded');
    expect(summary.pacing).toContain('the comparison held even splits');
  });

  it('only calls lower HR efficient when pace also improves', () => {
    const summary = buildComparisonSummary(
      workout({ pace_ms: 118000, heart_rate_avg: 155 }), workout(), { level: 'exact', axis: 'distance' }, [],
    );
    expect(summary.effort).toContain('improved efficiency');
    expect(summary.effort).not.toContain('—');
    const slower = buildComparisonSummary(workout({ pace_ms: 122000, heart_rate_avg: 150 }), workout(), { level: 'exact', axis: 'distance' }, []);
    expect(slower.effort).not.toContain('improved efficiency');
  });
});

describe('race replay playback', () => {
  it('races both boats over the shared distance on the session clocks', () => {
    // Boat 1 rows 2:00/500 (24s per 100m stroke), boat 2 rows 2:05/500 (25s)
    const playback = buildRacePlayback(workout(), workout({ strokes: strokesAtPace(125000) }));
    expect(playback).not.toBeNull();
    expect(playback.distance).toBeCloseTo(1900);
    expect(playback.boats[0].finish_s).toBeCloseTo(456);
    expect(playback.boats[1].finish_s).toBeCloseTo(475);
    expect(playback.duration_s).toBeCloseTo(475);

    const start = sampleRacePlayback(playback, 0);
    expect(start.boats[0].distance_m).toBe(0);
    expect(start.boats[1].distance_m).toBe(0);

    const mid = sampleRacePlayback(playback, 100);
    expect(mid.boats[0].distance_m).toBeCloseTo(100 / 24 * 100, 0);
    expect(mid.boats[1].distance_m).toBeCloseTo(400, 0);
    expect(mid.gap_m).toBeGreaterThan(0); // this session leads

    const end = sampleRacePlayback(playback, playback.duration_s);
    expect(end.complete).toBe(true);
    expect(end.boats[0].finished).toBe(true);
    expect(end.boats[0].distance_m).toBeCloseTo(1900);
    expect(end.boats[1].distance_m).toBeCloseTo(1900);
  });

  it('races the scored piece of an odometer-contaminated recording', () => {
    const playback = buildRacePlayback(odometerWorkout(), workout());
    expect(playback).not.toBeNull();
    expect(playback.distance).toBeLessThanOrEqual(2000);
    // Piece pace is 2:00/500 for both, so finish times are close, and the
    // contaminated boat must not spend its opening metres at warmup pace.
    const early = sampleRacePlayback(playback, 60);
    expect(early.boats[0].pace_ms).toBeCloseTo(120000, -3);
  });

  it('extends a stroke stream that stops one stroke short of the scored distance', () => {
    // Recordings typically end at the last stroke (e.g. 2,970m of a 3k);
    // the race must still finish at exactly 3,000m.
    const short3k = (secondsPerStroke, overrides = {}) => ({
      distance: 3000, time_ms: secondsPerStroke * 100000, pace_ms: 120000, heart_rate_avg: 150,
      strokes: Array.from({ length: 100 }, (_, index) => ({
        distance_m: index * 30, time_s: index * secondsPerStroke, pace_ms: 120000, stroke_rate: 24, heart_rate: 150,
      })), intervals: [], ...overrides,
    });
    const playback = buildRacePlayback(short3k(7.2), short3k(7.5));
    expect(playback.distance).toBe(3000);
    expect(playback.boats[0].finish_s).toBeCloseTo(720);
    expect(playback.boats[1].finish_s).toBeCloseTo(750);
    const end = sampleRacePlayback(playback, playback.duration_s);
    expect(end.boats[0].distance_m).toBe(3000);
    expect(end.boats[1].distance_m).toBe(3000);

    // Stroke clocks drift from the official totals; the race margin must
    // match the official time_ms the headline is built from.
    const drifted = buildRacePlayback(
      short3k(7.25, { time_ms: 696000 }), // strokes say 725s, official 11:36.0
      short3k(7.28, { time_ms: 700700 }), // strokes say 728s, official 11:40.7
    );
    expect(drifted.boats[0].finish_s).toBeCloseTo(696, 1);
    expect(drifted.boats[1].finish_s).toBeCloseTo(700.7, 1);
    expect(drifted.boats[1].finish_s - drifted.boats[0].finish_s).toBeCloseTo(4.7, 1);
  });

  it('declines to race unlike distances or workouts without strokes', () => {
    expect(buildRacePlayback(workout(), workout({ distance: 5000, strokes: Array.from({ length: 20 }, (_, index) => ({ distance_m: index * 250, time_s: index * 60, pace_ms: 120000 })) }))).toBeNull();
    expect(buildRacePlayback(workout(), workout({ strokes: [] }))).toBeNull();
  });
});

describe('solo race playback', () => {
  it('ties against an even split of the workout', () => {
    const playback = buildSoloRacePlayback(workout(), { paceMs: 120000 });
    expect(playback.solo).toBe(true);
    expect(playback.distance).toBeCloseTo(1900);
    expect(playback.boats[0].finish_s).toBeCloseTo(playback.boats[1].finish_s, 1);
  });

  it('beats a slower target pace and loses to a faster one', () => {
    const slower = buildSoloRacePlayback(workout(), { paceMs: 125000 });
    expect(slower.boats[1].finish_s).toBeGreaterThan(slower.boats[0].finish_s); // pacer slower -> you win
    const faster = buildSoloRacePlayback(workout(), { paceMs: 115000 });
    expect(faster.boats[1].finish_s).toBeLessThan(faster.boats[0].finish_s); // pacer faster -> you lose

    // The pace boat holds an even split the whole way.
    const mid = sampleRacePlayback(faster, faster.boats[1].finish_s / 2);
    expect(mid.boats[1].pace_ms).toBeCloseTo(115000, -2);
  });

  it('returns null without a pace or strokes', () => {
    expect(buildSoloRacePlayback(workout(), {})).toBeNull();
    expect(buildSoloRacePlayback(workout({ strokes: [] }), { paceMs: 120000 })).toBeNull();
  });

  it('reports complete when scrubbed to a float-rounded end of a tie race', () => {
    const playback = buildSoloRacePlayback(workout(), { paceMs: 120000 });
    // A scrubber rounds duration_s (e.g. 456.0000001) down a hair; the race
    // must still read as finished rather than one epsilon short.
    const scrubbed = Number(String(playback.duration_s).slice(0, 8));
    expect(sampleRacePlayback(playback, scrubbed).complete).toBe(true);
    expect(sampleRacePlayback(playback, playback.duration_s).boats.every(b => b.finished)).toBe(true);
  });
});

describe('comparisonMetricCards', () => {
  it('compares stored efficiency metrics with a better-direction flag', () => {
    const w1 = workout({ metrics: { watts_per_beat: 1.6, fade_index: -1.2, distance_per_stroke: 9.5 } });
    const w2 = workout({ metrics: { watts_per_beat: 1.5, fade_index: 2.0, distance_per_stroke: 9.3 } });
    const cards = comparisonMetricCards(w1, w2);

    const wattsPerBeat = cards.find(card => card.label === 'W / beat');
    expect(wattsPerBeat.better).toBe('up');
    expect(wattsPerBeat.delta).toBeCloseTo(0.1);

    // Negative fade (a negative split) must still be comparable
    const fade = cards.find(card => card.label === 'Fade');
    expect(fade).toBeTruthy();
    expect(fade.better).toBe('down');
    expect(fade.delta).toBeCloseTo(-3.2);
  });
});
