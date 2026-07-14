// Preset training programs. These are code-versioned templates, not DB rows:
// starting one materialises its sessions into planned_workouts (see
// programGenerator.js). Session objects use planned_workouts column names so
// generation is a straight insert. Interval totals are NOT set here - the
// server derives them (deriveIntervalTotals) at insert time.
//
// Pace is intentionally left null: presets express *relative* intensity ("2k
// pace + 5s") which the schema can't encode absolutely, and a wrong absolute
// pace would poison auto-matching. Intensity guidance lives in `notes`.

// Rest helpers (ms).
const R = (mmss) => {
  const [m, s] = mmss.split(':').map(Number);
  return (m * 60 + s) * 1000;
};

// Session constructors.
const steady = (m, notes) => ({ type: 'steady', target_distance: m, notes });
const steadyTime = (mmss, notes) => ({ type: 'steady', target_duration_ms: R(mmss), notes });
const reps = (n, distM, rest, notes) => ({
  type: 'intervals', interval_reps: n, interval_distance: distM, interval_rest_ms: R(rest), notes,
});
const repsTime = (n, workMmss, rest, notes) => ({
  type: 'intervals', interval_reps: n, interval_duration_ms: R(workMmss), interval_rest_ms: R(rest), notes,
});
const test = (m, notes) => ({ type: 'test', target_distance: m, notes });

// --- The Pete Plan: a 3-week rotating cycle of speed intervals, endurance
// intervals, and hard distance padded with steady meters. ------------------
const petePlan = {
  id: 'pete-plan',
  name: 'The Pete Plan',
  description:
    'The classic intermediate/advanced erg plan: a 3-week rotating cycle of '
    + 'speed intervals, endurance intervals and hard distance, built on a base '
    + 'of steady meters. Pick five training days and it repeats until your end date.',
  kind: 'cycle',
  cycleWeeks: 3,
  defaultWeeks: 12,
  minWeeks: 3,
  maxWeeks: 24,
  sessionsPerWeek: 5,
  weeks: [
    { sessions: [
      reps(8, 500, '3:30', 'Speed intervals. Around 2k pace; keep the splits even and build confidence, not heroics.'),
      steady(8000, 'Steady distance, 18–20 spm, conversational (UT2).'),
      reps(5, 1500, '5:00', 'Endurance intervals at ~2k pace + 4–5s. Controlled, repeatable splits.'),
      steady(10000, 'Steady distance, 18–20 spm.'),
      steady(5000, 'Hard distance: 5k at ~2k pace + 8–10s. Treat it as a benchmark.'),
    ] },
    { sessions: [
      reps(12, 250, '1:45', 'Short speed. Faster than 2k pace; sharp and relaxed, full recovery.'),
      steady(8000, 'Steady distance, 18–20 spm.'),
      reps(4, 2000, '5:00', 'Endurance intervals at ~2k pace + 5s. Hold form as fatigue builds.'),
      steady(10000, 'Steady distance, 18–20 spm.'),
      steady(6000, 'Hard distance: 6k at ~2k pace + 8s.'),
    ] },
    { sessions: [
      reps(4, 1000, '5:00', 'Speed/endurance at ~2k pace + 2–3s.'),
      steady(8000, 'Steady distance, 18–20 spm.'),
      { type: 'intervals', interval_reps: 3, interval_distance: 2500, interval_rest_ms: R('5:00'),
        notes: 'Waterfall: 3000m, 2500m, 2000m with 5:00 rest. Around 2k pace + 3s; negative-split the set.' },
      steady(10000, 'Steady distance, 18–20 spm.'),
      { type: 'intervals', interval_reps: 2, interval_distance: 6000, interval_rest_ms: R('10:00'),
        notes: '2×6k at ~2k pace + 10s, 10:00 rest. A hard aerobic squeeze.' },
    ] },
  ],
};

// --- Beginner Pete Plan: 24 weeks, 3 sessions/week, easing a new rower from
// short steady rows into structured intervals. Built programmatically so the
// progression stays smooth and reviewable. -------------------------------
function beginnerWeeks() {
  const weeks = [];
  for (let w = 0; w < 24; w++) {
    // Session 1 - endurance base, grows 5k → ~9k.
    const baseMeters = 5000 + Math.min(w, 16) * 250;
    const s1 = steady(baseMeters, 'Easy aerobic base. Rate 18–22 spm, nose-breathing pace.');

    // Session 2 - intervals introduced from week 3, lengthening over the plan.
    let s2;
    if (w < 2) {
      s2 = steadyTime('20:00', 'Relaxed 20 minutes. Focus on the drive sequence and a clean finish.');
    } else {
      const n = 4 + Math.floor(w / 8);          // 4 → 6 reps
      const dist = w < 8 ? 500 : w < 16 ? 750 : 1000;
      s2 = reps(n, dist, '2:00', 'Introductory intervals. Comfortably hard - you should want one more, not fewer.');
    }

    // Session 3 - a longer steady piece; every 6th week is a short test.
    let s3;
    if (w % 6 === 5) {
      s3 = test(w < 12 ? 2000 : 5000, 'Benchmark test. Warm up well, pick a pace you can hold, and record it.');
    } else {
      const longMeters = 6000 + Math.min(w, 18) * 350;
      s3 = steady(longMeters, 'Longer steady distance. Settle in and keep the rate low, 18–20 spm.');
    }

    weeks.push({ sessions: [s1, s2, s3] });
  }
  return weeks;
}

const beginnerPete = {
  id: 'beginner-pete',
  name: 'Beginner Pete Plan',
  description:
    'A gentle 24-week on-ramp for newer rowers, progressing from short steady '
    + 'rows into structured intervals and leaving you ready for the full Pete '
    + 'Plan. Three sessions a week.',
  kind: 'fixed',
  sessionsPerWeek: 3,
  weeks: beginnerWeeks(),
};

// --- 2k Race Prep: an 8-week peaking block anchored to a race date. Volume →
// race-pace work → sharpening → taper, with the 2k test on race day. -------
const twoKPrep = {
  id: '2k-prep',
  name: '2k Race Prep',
  description:
    'An 8-week block that peaks you for a 2k test or race. Builds a base, then '
    + 'sharpens race-pace speed and tapers into the final week. Set your race '
    + 'date and the last session lands on the day itself.',
  kind: 'race',
  sessionsPerWeek: 4,
  weeks: [
    { sessions: [ // W1 base
      steady(10000, 'Aerobic base, 18–20 spm.'),
      reps(4, 2000, '5:00', 'Threshold intervals at ~2k pace + 6s.'),
      steady(8000, 'Steady distance.'),
      reps(6, 500, '3:30', 'Speed primer around 2k pace.'),
    ] },
    { sessions: [ // W2 base+
      steady(12000, 'Longest steady of the block. Stay relaxed.'),
      reps(5, 1500, '5:00', 'Threshold intervals at ~2k pace + 5s.'),
      steady(8000, 'Steady distance.'),
      reps(8, 500, '3:00', 'Speed at ~2k pace, even splits.'),
    ] },
    { sessions: [ // W3
      steady(10000, 'Aerobic base.'),
      reps(4, 2000, '4:00', 'Threshold at ~2k pace + 4s, shorter rest.'),
      steady(8000, 'Steady distance.'),
      reps(4, 1000, '4:00', 'Race-pace 1ks. Lock onto goal split.'),
    ] },
    { sessions: [ // W4 test week
      steady(10000, 'Aerobic base.'),
      reps(6, 750, '3:00', 'Sharpening at ~2k pace − 1s.'),
      steady(6000, 'Easy steady, legs fresh.'),
      test(2000, 'Mid-block 2k test. Pace it evenly - this sets your race target.'),
    ] },
    { sessions: [ // W5 sharpen
      steady(8000, 'Aerobic base, rate down.'),
      reps(3, 2000, '5:00', 'Race-pace + 3s. Hold form deep into each rep.'),
      steady(6000, 'Steady distance.'),
      reps(8, 500, '2:30', 'Race-pace 500s, crisp catches.'),
    ] },
    { sessions: [ // W6 sharpen+
      steady(8000, 'Aerobic base.'),
      reps(4, 1000, '4:00', 'Race-pace 1ks. Practise the settle after the start.'),
      steady(6000, 'Steady distance.'),
      reps(6, 500, '2:30', 'Race-pace − 1s. Fast but controlled.'),
    ] },
    { sessions: [ // W7 peak
      steady(6000, 'Easy aerobic, staying loose.'),
      reps(4, 750, '3:00', 'Race-pace sharpeners.'),
      steady(5000, 'Easy steady.'),
      reps(3, 1000, '5:00', 'Race-pace − 1s. Full recovery, quality over quantity.'),
    ] },
    { sessions: [ // W8 taper + race
      steady(5000, 'Easy shake-out row.'),
      reps(4, 500, '3:00', 'Race-pace primer - just enough to feel sharp.'),
      steadyTime('20:00', 'Light pre-race loosener, 2–3 days out. Include a few 10-stroke bursts.'),
      { type: 'race', target_distance: 2000, anchor: 'race_date',
        notes: 'Race day. Warm up thoroughly, commit to your pace plan, and negative-split the second half.' },
    ] },
  ],
};

// --- Marathon Build: 16 weeks of long-distance volume peaking at a full
// marathon row. Three sessions/week: a growing long row, a steady mid-week
// piece, and low-rate intervals. -----------------------------------------
function marathonWeeks() {
  // Long-row progression (meters) with two recovery dips and a marathon finish.
  const longRow = [
    12000, 14000, 16000, 13000,   // build, recover
    18000, 20000, 22000, 17000,   // build, recover
    24000, 27000, 30000, 22000,   // build, recover
    32000, 35000, 25000, 42195,   // peak, taper, MARATHON
  ];
  return longRow.map((meters, w) => {
    const isRace = w === 15;
    const s1 = isRace
      ? { type: 'race', target_distance: 42195,
          notes: 'Marathon: 42,195m. Even pacing from the gun, fuel and hydrate on a schedule, keep the rate low.' }
      : steady(meters, 'Long row. Low and steady, 18–20 spm - build time on the handle, not intensity.');
    const s2 = steady(8000 + Math.min(w, 10) * 500, 'Mid-week steady distance to top up aerobic volume.');
    const s3 = isRace
      ? steadyTime('20:00', 'Pre-marathon shake-out. Easy, with a few relaxed bursts.')
      : reps(3, 3000 + Math.min(w, 8) * 250, '3:00', 'Low-rate intervals, 18–20 spm at steady effort - strength endurance.');
    return { sessions: [s1, s2, s3] };
  });
}

const marathonBuild = {
  id: 'marathon-build',
  name: 'Marathon Build',
  description:
    'Sixteen weeks of long-distance volume that grows your weekly long row '
    + 'toward a full marathon (42,195m). Three sessions a week, built around '
    + 'low-rate aerobic work.',
  kind: 'fixed',
  sessionsPerWeek: 3,
  weeks: marathonWeeks(),
};

export const PROGRAM_PRESETS = [petePlan, beginnerPete, twoKPrep, marathonBuild];

export function getPreset(id) {
  return PROGRAM_PRESETS.find(p => p.id === id) || null;
}

// The session index (week, slot) whose date must land on the race date, or
// null for non-race presets.
export function anchorSlot(preset) {
  for (let week = 0; week < preset.weeks.length; week++) {
    const slot = preset.weeks[week].sessions.findIndex(s => s.anchor === 'race_date');
    if (slot !== -1) return { week, slot };
  }
  return null;
}
