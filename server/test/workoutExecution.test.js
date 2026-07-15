import { describe, expect, it } from 'vitest';
import {
  classifyPacing,
  rateStability,
  analyzeFinish,
  strokeEffectiveness,
  classifyIntensity,
  computePhases,
  analyzeIntervals,
  buildWorkoutAnalysis,
  ANALYSIS_VERSION,
} from '../src/workoutExecution.js';

// Build a stroke stream from per-index overrides. Defaults give a clean
// 2:00/500m, 24 spm, 150 bpm, 200 W piece over `n` strokes.
function strokes(n, fn = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    stroke_number: i,
    time_s: i * 2,
    distance_m: i * 10,
    pace_ms: 120000,
    stroke_rate: 24,
    heart_rate: 150,
    watts: 200,
    ...fn(i, n),
  }));
}

describe('classifyPacing', () => {
  it('returns unknown below the sample floor', () => {
    expect(classifyPacing(strokes(4)).value).toBe('unknown');
  });

  it('flags even pacing', () => {
    expect(classifyPacing(strokes(20)).value).toBe('even');
  });

  it('flags a negative split', () => {
    const s = strokes(20, (i, n) => ({ pace_ms: i < n / 2 ? 122000 : 118000 }));
    expect(classifyPacing(s).value).toBe('negative_split');
  });

  it('flags a mild fade', () => {
    const s = strokes(20, (i, n) => ({ pace_ms: i < n / 2 ? 120000 : 122400 }));
    expect(classifyPacing(s).value).toBe('mild_fade');
  });

  it('flags a significant fade', () => {
    const s = strokes(20, (i, n) => ({ pace_ms: i < n / 2 ? 120000 : 127200 }));
    expect(classifyPacing(s).value).toBe('significant_fade');
  });

  it('flags variable pacing when there is no trend', () => {
    // quartiles low/high/low/high → non-monotonic, high CV
    const s = strokes(20, (i) => ({ pace_ms: (Math.floor(i / 5) % 2 === 0) ? 115000 : 130000 }));
    expect(classifyPacing(s).value).toBe('variable');
  });
});

describe('rateStability', () => {
  it('is stable for a steady rate', () => {
    expect(rateStability(strokes(20)).value).toBe('stable');
  });

  it('is variable for a swinging rate', () => {
    const s = strokes(20, (i) => ({ stroke_rate: i % 2 === 0 ? 20 : 30 }));
    expect(rateStability(s).value).toBe('variable');
  });

  it('is unknown below the sample floor', () => {
    expect(rateStability(strokes(10)).value).toBe('unknown');
  });
});

describe('analyzeFinish', () => {
  it('detects an accelerated finish', () => {
    const s = strokes(25, (i, n) => ({ pace_ms: i >= Math.floor(n * 0.92) ? 117000 : 120000 }));
    expect(analyzeFinish(s).value).toBe('accelerated');
  });

  it('detects a faded finish', () => {
    const s = strokes(25, (i, n) => ({ pace_ms: i >= Math.floor(n * 0.92) ? 123000 : 120000 }));
    expect(analyzeFinish(s).value).toBe('faded');
  });

  it('detects an even finish', () => {
    expect(analyzeFinish(strokes(25)).value).toBe('even');
  });
});

describe('strokeEffectiveness', () => {
  it('computes work per stroke and a stable trend', () => {
    const r = strokeEffectiveness({}, strokes(20));
    expect(r.value).toBe('stable');
    expect(r.work_per_stroke_joules).toBe(500); // 200W * 60 / 24 spm
  });

  it('flags a variable work-per-stroke trend', () => {
    const s = strokes(20, (i, n) => ({ watts: i < n / 2 ? 180 : 220 }));
    expect(strokeEffectiveness({}, s).value).toBe('variable');
  });

  it('falls back to a point estimate from workout averages without strokes', () => {
    const r = strokeEffectiveness({ pace_ms: 120000, stroke_rate: 24 }, []);
    expect(r.work_per_stroke_joules).toBeGreaterThan(0);
    expect(r.trend_percent).toBeNull();
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe('classifyIntensity', () => {
  it('bands by pace vs the personal benchmark', () => {
    expect(classifyIntensity({ workout: { pace_ms: 120000 }, benchmarkPaceMs: 115000 }).value).toBe('very_hard');
    expect(classifyIntensity({ workout: { pace_ms: 118000 }, benchmarkPaceMs: 118000 }).value).toBe('maximal');
    expect(classifyIntensity({ workout: { pace_ms: 160000 }, benchmarkPaceMs: 118000 }).value).toBe('easy');
  });

  it('is unknown without a benchmark', () => {
    expect(classifyIntensity({ workout: { pace_ms: 120000 }, benchmarkPaceMs: null }).value).toBe('unknown');
  });
});

describe('computePhases', () => {
  it('returns five phases with aggregates for a fixed-distance piece', () => {
    const phases = computePhases({ workout_type: 'FixedDistanceSplits' }, strokes(100));
    expect(phases.map(p => p.name)).toEqual(['start', 'settle', 'middle', 'pressure', 'finish']);
    expect(phases[0].avg_pace_ms).toBe(120000);
    expect(phases[0].avg_rate).toBe(24);
  });

  it('slices by time for a fixed-time piece', () => {
    const phases = computePhases({ workout_type: 'FixedTimeSplits' }, strokes(100));
    expect(phases).toHaveLength(5);
    expect(phases[4].name).toBe('finish');
  });

  it('returns nothing below the stroke floor', () => {
    expect(computePhases({ workout_type: 'FixedDistanceSplits' }, strokes(6))).toEqual([]);
  });
});

describe('analyzeIntervals', () => {
  it('summarizes rep spread, degradation and a hot first rep', () => {
    const reps = [
      { type: 'work', pace_ms: 110000 },
      { type: 'rest', pace_ms: 0 },
      { type: 'work', pace_ms: 112000 },
      { type: 'work', pace_ms: 114000 },
      { type: 'work', pace_ms: 116000 },
    ];
    const r = analyzeIntervals(reps);
    expect(r.rep_count).toBe(4);
    expect(r.fastest_rep_index).toBe(0);
    expect(r.slowest_rep_index).toBe(3);
    expect(r.degradation_percent).toBeGreaterThan(0);
    expect(r.first_rep_fast).toBe(true);
  });

  it('returns null below two work reps', () => {
    expect(analyzeIntervals([{ type: 'work', pace_ms: 110000 }])).toBeNull();
  });
});

describe('buildWorkoutAnalysis', () => {
  it('builds a versioned continuous analysis with phases, no interval block', () => {
    const analysis = buildWorkoutAnalysis({
      workout: { pace_ms: 120000, stroke_rate: 24, workout_type: 'FixedDistanceSplits' },
      strokes: strokes(100),
      intervals: [],
      structure: { value: 'continuous', subtype: 'fixed_distance', confidence: 1, reasons: [] },
      benchmarkPaceMs: 115000,
      rateDisciplinePct: 94,
    });
    expect(analysis.version).toBe(ANALYSIS_VERSION);
    expect(analysis.structure.value).toBe('continuous');
    expect(analysis.execution.pacing.value).toBe('even');
    expect(analysis.execution.rate.discipline_pct).toBe(94);
    expect(analysis.phases).toHaveLength(5);
    expect(analysis.intervals).toBeNull();
  });

  it('builds an interval analysis with no pacing/phases', () => {
    const analysis = buildWorkoutAnalysis({
      workout: { pace_ms: 110000, stroke_rate: 28, workout_type: 'FixedDistanceInterval' },
      strokes: strokes(40),
      intervals: [
        { type: 'work', pace_ms: 110000 },
        { type: 'work', pace_ms: 113000 },
        { type: 'work', pace_ms: 116000 },
      ],
      structure: { value: 'interval', subtype: 'fixed_distance', confidence: 1, reasons: [] },
    });
    expect(analysis.execution.pacing).toBeNull();
    expect(analysis.phases).toEqual([]);
    expect(analysis.intervals.rep_count).toBe(3);
  });
});
