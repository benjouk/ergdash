// Percentile benchmarking against the wider erg population.
//
// The reference distributions below are an APPROXIMATE parametric model of the
// public Concept2 season rankings (log.concept2.com/rankings): per-sex 2k pace
// anchors at fixed percentiles, shifted per event by a pace offset and scaled
// by age-band and weight-class factors. Concept2 publishes no API for the
// rankings, so this stays a bundled estimate - every result carries
// approximate: true and the UI labels it as an estimate. All paces are
// seconds per 500m.

// Percentile -> 2k pace (s/500m) for ranked heavyweight athletes in the
// reference band (19-39). Percentile 90 means "faster than 90% of entrants".
const SEX_ANCHORS = {
  M: [
    [99, 91.25], // 6:05
    [95, 96.25], // 6:25
    [90, 98.75], // 6:35
    [75, 103.75], // 6:55
    [50, 108.75], // 7:15
    [25, 116.25], // 7:45
    [10, 125.0], // 8:20
    [5, 132.5], // 8:50
  ],
  F: [
    [99, 104.5], // 6:58
    [95, 110.0], // 7:20
    [90, 113.0], // 7:32
    [75, 118.75], // 7:55
    [50, 125.0], // 8:20
    [25, 132.5], // 8:50
    [10, 141.25], // 9:25
    [5, 150.0], // 10:00
  ],
};

// Pace offset (s/500m) from the 2k anchor pace for each ranked event. Distance
// events are keyed d<metres>, fixed-time events t<seconds> (compared on the
// average pace of the distance covered).
const EVENT_OFFSETS = {
  d500: -7,
  d1000: -3.5,
  d2000: 0,
  d5000: 4.5,
  d6000: 5.5,
  d10000: 7.5,
  d21097: 10.5,
  d42195: 14,
  t1800: 7,
  t3600: 9.5,
};

// Multiplicative pace factors per ranking age band, fitted to how the ranked
// medians drift with age. Below 30 the distribution is close to the reference.
const AGE_BANDS = [
  { band: '19-29', max: 29, factor: 1.0 },
  { band: '30-39', max: 39, factor: 1.0 },
  { band: '40-49', max: 49, factor: 1.025 },
  { band: '50-59', max: 59, factor: 1.06 },
  { band: '60-69', max: 69, factor: 1.11 },
  { band: '70+', max: Infinity, factor: 1.19 },
];

// Lightweight cutoffs per Concept2 ranking rules (75kg men / 61.5kg women)
// and the pace factor between the ranked lightweight and heavyweight pools.
const LWT_LIMIT_KG = { M: 75, F: 61.5 };
const LWT_FACTOR = { M: 1.045, F: 1.04 };

export function weightClass(sex, weightKg) {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return 'hwt';
  return weightKg <= LWT_LIMIT_KG[sex] ? 'lwt' : 'hwt';
}

export function ageBand(age) {
  if (!Number.isFinite(age) || age <= 0) return null;
  return AGE_BANDS.find(b => age <= b.max).band;
}

export function eventKeyForDistance(distance) {
  const key = `d${distance}`;
  return key in EVENT_OFFSETS ? key : null;
}

export function eventKeyForDuration(durationS) {
  const key = `t${durationS}`;
  return key in EVENT_OFFSETS ? key : null;
}

// Age in the current rowing season (rough calendar-year age; the rankings
// bucket by age at time of row, which a birth year can only approximate).
export function ageFromBirthYear(birthYear, now = new Date()) {
  const year = Number(birthYear);
  if (!Number.isInteger(year) || year < 1900) return null;
  const age = now.getUTCFullYear() - year;
  return age >= 5 && age <= 110 ? age : null;
}

// Percentile of a pace within one event/sex/age/weight bucket, interpolated
// linearly between anchors and clamped to [1, 99]. Returns null when the
// event is unranked or the athlete's sex is unknown (the distributions are
// sex-specific, so there is no meaningful unisex percentile).
export function percentileForPace({ event, paceMs, sex, age = null, weightKg = null }) {
  const offset = EVENT_OFFSETS[event];
  const anchors = SEX_ANCHORS[sex];
  if (offset == null || anchors == null || !Number.isFinite(paceMs) || paceMs <= 0) return null;

  const band = ageBand(age);
  const bandFactor = band ? AGE_BANDS.find(b => b.band === band).factor : 1.0;
  const wclass = weightClass(sex, weightKg);
  const classFactor = wclass === 'lwt' ? LWT_FACTOR[sex] : 1.0;

  const paceS = paceMs / 1000;
  // Anchor paces for this bucket, fastest (highest percentile) first.
  const curve = anchors.map(([pct, base]) => [pct, (base + offset) * bandFactor * classFactor]);

  let percentile;
  if (paceS <= curve[0][1]) {
    percentile = 99;
  } else if (paceS >= curve[curve.length - 1][1]) {
    percentile = Math.max(1, Math.round(curve[curve.length - 1][0] * (curve[curve.length - 1][1] / paceS) ** 4));
  } else {
    for (let i = 0; i < curve.length - 1; i++) {
      const [pctA, paceA] = curve[i];
      const [pctB, paceB] = curve[i + 1];
      if (paceS >= paceA && paceS <= paceB) {
        const t = paceB === paceA ? 0 : (paceS - paceA) / (paceB - paceA);
        percentile = Math.round(pctA + (pctB - pctA) * t);
        break;
      }
    }
  }

  return {
    percentile,
    top_percent: Math.max(1, 100 - percentile),
    sex,
    age_band: band,
    weight_class: wclass,
    approximate: true,
  };
}

// Athlete context from the profile's settings rows ({ key: value } object).
// Returns null when sex is unset - benchmarking is opt-in via Settings.
export function athleteFromSettings(settings, now = new Date()) {
  const sex = settings?.sex;
  if (sex !== 'M' && sex !== 'F') return null;
  return {
    sex,
    age: ageFromBirthYear(settings.birth_year, now),
    weightKg: Number(settings.weight_kg) > 0 ? Number(settings.weight_kg) : null,
  };
}
