// FIT import (binary Garmin format written by the PM5 to USB and exported by
// ErgData). Decoded with the official @garmin/fitsdk: session messages give
// the summary, laps give intervals, records give time-series samples.
import { Decoder, Stream } from '@garmin/fitsdk';
import { formatLocalDate } from './normalize.js';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z).
const FIT_EPOCH_S = 631065600;

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // The SDK converts dateTime fields to Date but leaves localDateTime as
    // raw FIT-epoch seconds.
    return new Date((value + FIT_EPOCH_S) * 1000);
  }
  return null;
}

// FIT timestamps are UTC. When the file carries a localTimestamp (the PM5
// does), its offset from the UTC timestamp recovers the machine's wall-clock
// time; otherwise fall back to the server's local time.
function localDateFor(utcDate, offsetMs) {
  if (utcDate === null) return null;
  if (offsetMs === null) return formatLocalDate(utcDate);
  const shifted = new Date(utcDate.getTime() + offsetMs);
  // The shifted Date's UTC components ARE the local wall-clock values.
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')} `
    + `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}:${String(shifted.getUTCSeconds()).padStart(2, '0')}`;
}

function paceMsFromSpeed(speedMps) {
  if (speedMps === null || speedMps <= 0) return null;
  return Math.round((500 / speedMps) * 1000);
}

export function parseFit(buffer, filename) {
  const workouts = [];

  let messages;
  try {
    const stream = Stream.fromBuffer(buffer);
    if (!Decoder.isFIT(stream)) {
      return { workouts, errors: ['Not a FIT file'] };
    }
    const decoder = new Decoder(stream);
    const result = decoder.read();
    messages = result.messages;
    if (result.errors?.length && (!messages || Object.keys(messages).length === 0)) {
      return { workouts, errors: result.errors.map(e => `FIT decode failed: ${e.message || e}`) };
    }
  } catch (err) {
    return { workouts, errors: [`FIT decode failed: ${err.message}`] };
  }

  const sessions = messages.sessionMesgs || [];
  if (sessions.length === 0) {
    return { workouts, errors: ['FIT file has no session messages'] };
  }

  // localTimestamp lives on the activity message; one offset per file.
  const activity = (messages.activityMesgs || [])[0];
  let offsetMs = null;
  if (activity) {
    const utc = toDate(activity.timestamp);
    const local = toDate(activity.localTimestamp);
    if (utc && local) offsetMs = local.getTime() - utc.getTime();
  }

  const allLaps = messages.lapMesgs || [];
  const allRecords = messages.recordMesgs || [];

  sessions.forEach((session, sessionIndex) => {
    const start = toDate(session.startTime);
    const startMs = start ? start.getTime() : null;
    const endMs = startMs !== null && session.totalElapsedTime
      ? startMs + session.totalElapsedTime * 1000
      : null;

    const inSession = (mesg) => {
      if (sessions.length === 1) return true;
      const t = toDate(mesg.startTime || mesg.timestamp)?.getTime();
      if (t == null || startMs === null) return false;
      return t >= startMs - 1000 && (endMs === null || t <= endMs + 1000);
    };

    const laps = allLaps.filter(inSession);
    const records = allRecords.filter(inSession);

    const intervals = laps.map(lap => {
      const isRest = lap.intensity === 'rest'
        || (toNumber(lap.totalTimerTime) > 0 && (toNumber(lap.totalDistance) || 0) < 5);
      const lapTimeS = toNumber(lap.totalTimerTime) ?? toNumber(lap.totalElapsedTime);
      const cadence = toNumber(lap.avgCadence);
      return {
        type: isRest ? 'rest' : 'work',
        distance: Math.round(toNumber(lap.totalDistance) || 0),
        time_ms: lapTimeS ? Math.round(lapTimeS * 1000) : null,
        stroke_rate: cadence !== null && cadence >= 10 && cadence <= 60 ? cadence : null,
        stroke_count: toNumber(lap.totalCycles) ? Math.round(lap.totalCycles) : null,
        calories: toNumber(lap.totalCalories) ? Math.round(lap.totalCalories) : null,
        heart_rate_avg: toNumber(lap.avgHeartRate) ? Math.round(lap.avgHeartRate) : null,
        heart_rate_max: toNumber(lap.maxHeartRate) ? Math.round(lap.maxHeartRate) : null,
      };
    });

    const samples = records.map(record => {
      const t = toDate(record.timestamp)?.getTime();
      const cadence = toNumber(record.cadence);
      return {
        time_s: (t != null && startMs !== null) ? (t - startMs) / 1000 : null,
        distance_m: toNumber(record.distance),
        pace_ms: paceMsFromSpeed(toNumber(record.speed)),
        watts: toNumber(record.power),
        stroke_rate: cadence,
        heart_rate: toNumber(record.heartRate) ? Math.round(record.heartRate) : null,
      };
    });

    // Prefer timer time (work only) over elapsed (includes rest/pauses),
    // matching how Concept2 reports workout time.
    const timeS = toNumber(session.totalTimerTime) ?? toNumber(session.totalElapsedTime);
    const distance = toNumber(session.totalDistance);
    const avgCadence = toNumber(session.avgCadence);
    const hasRest = intervals.some(iv => iv.type === 'rest');

    workouts.push({
      date: localDateFor(start, offsetMs),
      timezone: null,
      workout_type: hasRest ? 'VariableInterval' : 'JustRow',
      distance: distance !== null ? Math.round(distance) : null,
      time_ms: timeS ? Math.round(timeS * 1000) : null,
      stroke_rate: avgCadence !== null && avgCadence >= 10 && avgCadence <= 60 ? avgCadence : null,
      stroke_count: toNumber(session.totalCycles) ? Math.round(session.totalCycles) : null,
      calories: toNumber(session.totalCalories) ? Math.round(session.totalCalories) : null,
      heart_rate_avg: toNumber(session.avgHeartRate) ? Math.round(session.avgHeartRate) : null,
      heart_rate_max: toNumber(session.maxHeartRate) ? Math.round(session.maxHeartRate) : null,
      drag_factor: null,
      comments: null,
      intervals: intervals.length > 1 ? intervals : null,
      samples,
      source_meta: {
        format: 'fit',
        filename,
        row_index: sessionIndex,
        c2_log_id: null,
      },
    });
  });

  return { workouts, errors: [] };
}
