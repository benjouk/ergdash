import { isIntervalWorkoutType } from './workoutTypes.js';

export function workoutTag(workout) {
  return workout?.inferred_tag === 'interval' ? 'interval' : 'endurance';
}

export function isIntervalWorkout(workout) {
  return workoutTag(workout) === 'interval' || isIntervalWorkoutType(workout?.workout_type);
}

function family(workout) {
  if (isIntervalWorkout(workout)) return 'interval';
  if (/FixedTime/.test(workout?.workout_type || '')) return 'time';
  if (/FixedDistance/.test(workout?.workout_type || '')) return 'distance';
  return 'open';
}

function relativeDifference(a, b) {
  if (!(a > 0) || !(b > 0)) return Infinity;
  return Math.abs(a - b) / Math.max(a, b);
}

function workIntervals(intervals = []) {
  return intervals.filter(interval => interval?.type !== 'rest');
}

function restsAfterWork(intervals = []) {
  const rests = [];
  for (let index = 0; index < intervals.length; index += 1) {
    if (intervals[index]?.type === 'rest') rests.push(intervals[index].time_ms || 0);
  }
  return rests;
}

function intervalTarget(interval) {
  if (interval?.distance > 0) return { mode: 'distance', value: interval.distance };
  if (interval?.time_ms > 0) return { mode: 'time', value: interval.time_ms };
  return { mode: 'unknown', value: 0 };
}

function compareIntervals(intervals1, intervals2) {
  const work1 = workIntervals(intervals1);
  const work2 = workIntervals(intervals2);
  if (work1.length === 0 || work2.length === 0 || work1.length !== work2.length) return null;

  const targets = work1.map((interval, index) => {
    const a = intervalTarget(interval);
    const b = intervalTarget(work2[index]);
    return { sameMode: a.mode === b.mode && a.mode !== 'unknown', difference: relativeDifference(a.value, b.value) };
  });
  if (targets.some(target => !target.sameMode)) return null;

  const rests1 = restsAfterWork(intervals1);
  const rests2 = restsAfterWork(intervals2);
  const comparableRests = rests1.length === rests2.length;
  const exactRests = comparableRests && rests1.every((rest, index) => Math.abs(rest - rests2[index]) <= 5000);
  const closeRests = comparableRests && rests1.every((rest, index) => relativeDifference(rest || 1, rests2[index] || 1) <= 0.2);

  if (targets.every(target => target.difference <= 0.01) && exactRests) return 'exact';
  if (targets.every(target => target.difference <= 0.05) && (rests1.length === 0 || closeRests)) return 'close';
  return null;
}

export function classifyComparison(current, candidate, currentIntervals = [], candidateIntervals = []) {
  if (!current || !candidate || current.id === candidate.id || current.type !== candidate.type) {
    return { level: 'other', reason: 'Different workout', axis: 'percent' };
  }

  const sameTag = workoutTag(current) === workoutTag(candidate);
  const currentFamily = family(current);
  const candidateFamily = family(candidate);

  if (sameTag && currentFamily === 'interval' && candidateFamily === 'interval') {
    const intervalMatch = compareIntervals(currentIntervals, candidateIntervals);
    if (intervalMatch === 'exact') {
      return { level: 'exact', reason: 'Same interval structure', axis: 'distance' };
    }
    if (intervalMatch === 'close') {
      return { level: 'close', reason: 'Similar interval structure', axis: 'percent' };
    }
    return { level: 'other', reason: 'Different interval structure', axis: 'percent' };
  }

  // Concept2 can record an otherwise ordinary distance piece as JustRow
  // (for example when the athlete rows through the target rather than
  // programming it on the monitor). Treat that as comparable with a fixed
  // distance endurance piece when the achieved distances align. The tag
  // check deliberately keeps interval totals such as 5x1k out of this path.
  const justRowDistancePair = (
    (currentFamily === 'open' && candidateFamily === 'distance')
    || (currentFamily === 'distance' && candidateFamily === 'open')
  );
  if (sameTag && justRowDistancePair) {
    const difference = relativeDifference(current.distance, candidate.distance);
    if (difference <= 0.01) return { level: 'exact', reason: 'Same distance', axis: 'distance' };
    if (difference <= 0.05) return { level: 'close', reason: 'Similar distance', axis: 'percent' };
  }

  if (sameTag && currentFamily === candidateFamily && currentFamily === 'distance') {
    const difference = relativeDifference(current.distance, candidate.distance);
    if (difference <= 0.01) return { level: 'exact', reason: 'Same distance', axis: 'distance' };
    if (difference <= 0.05) return { level: 'close', reason: 'Similar distance', axis: 'percent' };
  }

  if (sameTag && currentFamily === candidateFamily && currentFamily === 'time') {
    const difference = relativeDifference(current.time_ms, candidate.time_ms);
    if (difference <= 0.01) return { level: 'exact', reason: 'Same duration', axis: 'time' };
    if (difference <= 0.05) return { level: 'close', reason: 'Similar duration', axis: 'percent' };
  }

  if (sameTag && currentFamily === candidateFamily && currentFamily === 'open') {
    const distanceDifference = relativeDifference(current.distance, candidate.distance);
    const timeDifference = relativeDifference(current.time_ms, candidate.time_ms);
    if (Math.min(distanceDifference, timeDifference) <= 0.01) {
      return { level: 'exact', reason: distanceDifference <= timeDifference ? 'Same distance' : 'Same duration', axis: distanceDifference <= timeDifference ? 'distance' : 'time' };
    }
    if (Math.min(distanceDifference, timeDifference) <= 0.05) {
      return { level: 'close', reason: 'Similar open row', axis: 'percent' };
    }
  }

  return {
    level: 'other',
    reason: sameTag ? 'Different workout format' : 'Different workout category',
    axis: 'percent',
  };
}

export function rankComparisonCandidates(current, candidates) {
  const levelRank = { exact: 0, close: 1, other: 2 };
  const currentDate = new Date(current.date).getTime();
  return [...candidates].sort((a, b) => {
    const level = levelRank[a.comparison_match.level] - levelRank[b.comparison_match.level];
    if (level !== 0) return level;
    const aDate = new Date(a.date).getTime();
    const bDate = new Date(b.date).getTime();
    const aEarlier = aDate < currentDate ? 0 : 1;
    const bEarlier = bDate < currentDate ? 0 : 1;
    if (aEarlier !== bEarlier) return aEarlier - bEarlier;
    const proximity = Math.abs(aDate - currentDate) - Math.abs(bDate - currentDate);
    if (proximity !== 0) return proximity;
    return bDate - aDate;
  });
}
