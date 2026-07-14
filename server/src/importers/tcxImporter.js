// TCX import (Garmin Training Center XML - what ErgData and most training
// apps export for indoor rows). Each Activity becomes one workout: Laps map
// to work intervals and Trackpoints become time-series samples.
import { XMLParser } from 'fast-xml-parser';
import { formatLocalDate } from './normalize.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// HeartRateBpm nests as { Value: 152 }.
function hrValue(node) {
  const n = toNumber(node?.Value ?? node);
  return n !== null && n > 0 ? Math.round(n) : null;
}

// Watts lives under Extensions in a namespace-prefixed TPX element; scan for
// any key ending in 'TPX' to stay prefix-agnostic.
function trackpointWatts(tp) {
  const extensions = tp?.Extensions;
  if (!extensions || typeof extensions !== 'object') return null;
  for (const [key, value] of Object.entries(extensions)) {
    if (key.endsWith('TPX') && value && typeof value === 'object') {
      const watts = toNumber(value.Watts ?? value['ns3:Watts']);
      if (watts !== null) return watts;
    }
  }
  return null;
}

export function parseTcx(buffer, filename) {
  const workouts = [];

  let doc;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: true,
      // Strip namespace prefixes so ns-qualified files parse like plain ones.
      transformTagName: tag => tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag,
    });
    doc = parser.parse(buffer.toString('utf8'));
  } catch (err) {
    return { workouts, errors: [`TCX parse failed: ${err.message}`] };
  }

  const activities = asArray(doc?.TrainingCenterDatabase?.Activities?.Activity);
  if (activities.length === 0) {
    return { workouts, errors: ['TCX has no activities'] };
  }

  activities.forEach((activity, activityIndex) => {
    const laps = asArray(activity.Lap);
    if (laps.length === 0) return;

    const startIso = laps[0]['@_StartTime'] || activity.Id;
    const start = startIso ? new Date(startIso) : null;
    const startMs = start && !Number.isNaN(start.getTime()) ? start.getTime() : null;

    let totalTimeMs = 0;
    let totalDistance = 0;
    let calories = 0;
    let hrMax = null;
    const intervals = [];
    const samples = [];

    for (const lap of laps) {
      const lapTimeS = toNumber(lap.TotalTimeSeconds);
      const lapDistance = toNumber(lap.DistanceMeters);
      const lapHrAvg = hrValue(lap.AverageHeartRateBpm);
      const lapHrMax = hrValue(lap.MaximumHeartRateBpm);
      const lapCalories = toNumber(lap.Calories);
      const cadence = toNumber(lap.Cadence);

      totalTimeMs += lapTimeS ? Math.round(lapTimeS * 1000) : 0;
      totalDistance += lapDistance ? Math.round(lapDistance) : 0;
      calories += lapCalories || 0;
      if (lapHrMax !== null && (hrMax === null || lapHrMax > hrMax)) hrMax = lapHrMax;

      // TCX has no explicit rest laps; a lap with time but ~no distance is a
      // rest interval on an erg (the flywheel isn't moving).
      const isRest = lapTimeS > 0 && (!lapDistance || lapDistance < 5);
      intervals.push({
        type: isRest ? 'rest' : 'work',
        distance: lapDistance ? Math.round(lapDistance) : 0,
        time_ms: lapTimeS ? Math.round(lapTimeS * 1000) : null,
        stroke_rate: cadence !== null && cadence >= 10 && cadence <= 60 ? cadence : null,
        stroke_count: null,
        calories: lapCalories ? Math.round(lapCalories) : null,
        heart_rate_avg: lapHrAvg,
        heart_rate_max: lapHrMax,
      });

      for (const track of asArray(lap.Track)) {
        for (const tp of asArray(track.Trackpoint)) {
          const timeIso = tp.Time ? new Date(tp.Time).getTime() : NaN;
          const timeS = (startMs !== null && !Number.isNaN(timeIso))
            ? (timeIso - startMs) / 1000
            : null;
          samples.push({
            time_s: timeS,
            distance_m: toNumber(tp.DistanceMeters),
            pace_ms: null, // derived from deltas at insert time
            watts: trackpointWatts(tp),
            stroke_rate: toNumber(tp.Cadence),
            heart_rate: hrValue(tp.HeartRateBpm),
          });
        }
      }
    }

    const workIntervals = intervals.filter(iv => iv.type === 'work');
    const workTimeMs = workIntervals.reduce((sum, iv) => sum + (iv.time_ms || 0), 0);
    const hasRest = intervals.some(iv => iv.type === 'rest');

    workouts.push({
      date: start && startMs !== null ? formatLocalDate(start) : null,
      timezone: null,
      workout_type: hasRest ? 'VariableInterval' : 'JustRow',
      distance: totalDistance > 0 ? totalDistance : null,
      // C2 convention: time_ms is work time, rest excluded.
      time_ms: workTimeMs > 0 ? workTimeMs : (totalTimeMs > 0 ? totalTimeMs : null),
      stroke_rate: null, // derived from samples if present
      stroke_count: null,
      calories: calories > 0 ? Math.round(calories) : null,
      heart_rate_avg: null, // derived from samples if present
      heart_rate_max: hrMax,
      drag_factor: null,
      comments: null,
      // A single work lap is just the whole workout, not an interval session.
      intervals: intervals.length > 1 ? intervals : null,
      samples,
      source_meta: {
        format: 'tcx',
        filename,
        row_index: activityIndex,
        c2_log_id: null,
      },
    });
  });

  return { workouts, errors: [] };
}
