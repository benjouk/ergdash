// Duplicate detection between a parsed import row and workouts already in
// the DB, plus the enrich-merge that fills missing data into the existing
// row (the Concept2 copy stays canonical).
import {
  parseEditedFields,
  serializeEditedFields,
} from '../workoutFields.js';
import { writeSamples } from './normalize.js';
import { writeIntervals } from '../sync.js';

// Scalar columns a merge may fill when the existing row lacks them.
export const MERGEABLE_FIELDS = [
  'heart_rate_avg', 'heart_rate_max', 'drag_factor',
  'stroke_rate', 'stroke_count', 'calories',
];

const START_TOLERANCE_S = 300;

function startDeltaSeconds(dateA, dateB) {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(a - b) / 1000;
}

function distanceMatches(a, b) {
  if (!a || !b) return false;
  return Math.abs(a - b) <= Math.max(5, a * 0.01);
}

function timeMatches(a, b) {
  if (!a || !b) return false;
  return Math.abs(a - b) <= Math.max(2000, a * 0.02);
}

// What an enrich-merge into `existing` would add from `workout`.
export function computeMergeable(db, existing, workout) {
  const fields = MERGEABLE_FIELDS.filter(
    name => (existing[name] == null || existing[name] === 0) && workout[name] != null
  );
  const hasIntervals = db.prepare(
    'SELECT COUNT(*) AS c FROM intervals WHERE workout_id = ?'
  ).get(existing.id).c > 0;
  return {
    fields,
    strokes: !existing.has_stroke_data && (workout.samples?.length || 0) > 0,
    intervals: !hasIntervals && (workout.intervals?.length || 0) > 0,
  };
}

// Finds the best existing match for a normalized workout. Returns null or
// { status: 'already_imported'|'exact'|'likely', match, matched_on }.
export function findDuplicate(db, workout, fingerprint) {
  if (fingerprint) {
    const imported = db.prepare(
      'SELECT * FROM workouts WHERE import_fingerprint = ?'
    ).get(fingerprint);
    if (imported) {
      return { status: 'already_imported', match: imported, matched_on: ['fingerprint'] };
    }
  }

  if (!workout.date || !workout.distance || !workout.time_ms) return null;

  const logId = workout.source_meta?.c2_log_id;
  if (logId) {
    const byId = db.prepare('SELECT * FROM workouts WHERE id = ?').get(logId);
    // The log id is client-supplied (parsed from the file, then round-tripped
    // through the preview), so it only counts as identity when the row's own
    // numbers corroborate it — distance, time, AND when it happened. Erg
    // training repeats distances and times week after week, so without the
    // temporal check a crafted payload could name any workout id that shares
    // a common distance/time and merge into it.
    if (byId
        && distanceMatches(workout.distance, byId.distance)
        && timeMatches(workout.time_ms, byId.time_ms)) {
      const delta = startDeltaSeconds(workout.date, byId.date);
      const sameDay = byId.date?.slice(0, 10) === workout.date.slice(0, 10);
      if ((delta !== null && delta <= START_TOLERANCE_S) || sameDay) {
        return { status: 'exact', match: byId, matched_on: ['log_id'] };
      }
    }
  }

  const day = workout.date.slice(0, 10);
  const candidates = db.prepare(`
    SELECT * FROM workouts
    WHERE substr(date, 1, 10) BETWEEN date(?, '-1 day') AND date(?, '+1 day')
  `).all(day, day);

  let best = null;
  for (const candidate of candidates) {
    if (!distanceMatches(workout.distance, candidate.distance)) continue;
    if (!timeMatches(workout.time_ms, candidate.time_ms)) continue;

    const delta = startDeltaSeconds(workout.date, candidate.date);
    const sameDay = candidate.date?.slice(0, 10) === day;
    const exact = delta !== null && delta <= START_TOLERANCE_S;
    if (!exact && !sameDay) continue;

    const status = exact ? 'exact' : 'likely';
    const rank = delta ?? Infinity;
    if (!best || rank < best.rank) {
      best = {
        status,
        match: candidate,
        matched_on: exact
          ? ['distance', 'time', 'start_time']
          : ['distance', 'time', 'same_day'],
        rank,
      };
    }
  }

  if (!best) return null;
  const { rank, ...result } = best;
  return result;
}

// Commit-time guard: the client's requested merge target must still be what
// duplicate detection finds for this row. Without this, a crafted or stale
// commit payload could merge an arbitrary imported row into any workout,
// overwriting its missing fields/splits/strokes and stealing its
// import fingerprint.
export function resolveMergeTarget(db, workout, fingerprint, targetId) {
  if (!Number.isInteger(targetId)) {
    return { error: 'merge target not found' };
  }
  const found = findDuplicate(db, workout, fingerprint);
  if (!found || found.status === 'already_imported') {
    return { error: 'no duplicate detected for this row — import as new instead' };
  }
  if (found.match.id !== targetId) {
    return { error: `merge target ${targetId} does not match the detected duplicate (${found.match.id})` };
  }
  return { target: found.match };
}

// Enrich-merge: fill only what the existing row is missing. Filled scalar
// columns are recorded in edited_fields on c2 rows so the next sync doesn't
// null them back out (and revert-to-C2 can undo the merge).
export function mergeIntoExisting(db, existing, workout, fingerprint) {
  const mergeable = computeMergeable(db, existing, workout);
  const filled = {};
  for (const name of mergeable.fields) {
    filled[name] = workout[name];
  }

  let wroteStrokes = 0;
  db.transaction(() => {
    if (Object.keys(filled).length > 0) {
      const updates = { ...filled };
      if (existing.source === 'c2') {
        const edited = new Set(parseEditedFields(existing.edited_fields));
        Object.keys(filled).forEach(name => edited.add(name));
        updates.edited_fields = serializeEditedFields([...edited]);
      }
      const setClause = Object.keys(updates).map(name => `${name} = ?`).join(', ');
      db.prepare(`UPDATE workouts SET ${setClause} WHERE id = ?`)
        .run(...Object.values(updates), existing.id);
    }

    if (mergeable.intervals) {
      writeIntervals(db, existing.id, workout.intervals.map(iv => ({
        type: iv.type,
        distance: iv.distance ?? 0,
        time: iv.time_ms != null ? iv.time_ms / 100 : null, // writeIntervals expects tenths
        stroke_rate: iv.stroke_rate ?? null,
        stroke_count: iv.stroke_count ?? null,
        calories_total: iv.calories ?? null,
        heart_rate: (iv.heart_rate_avg || iv.heart_rate_max)
          ? { average: iv.heart_rate_avg ?? null, max: iv.heart_rate_max ?? null }
          : null,
      })));
    }

    if (mergeable.strokes) {
      wroteStrokes = writeSamples(db, existing.id, workout.samples);
    }

    // Record the fingerprint on the target so re-importing the same file
    // previews this row as already_imported.
    if (fingerprint && !existing.import_fingerprint) {
      db.prepare('UPDATE workouts SET import_fingerprint = ? WHERE id = ?')
        .run(fingerprint, existing.id);
    }
  })();

  return {
    filledFields: Object.keys(filled),
    wroteIntervals: mergeable.intervals,
    wroteStrokes: wroteStrokes > 0,
  };
}
