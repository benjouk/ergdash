// Low-level helpers shared by sync, the workout mutation routes, and the
// importers. Kept dependency-free so nothing here can create import cycles.

// Columns that Concept2 sync owns on a 'c2' workout. A user correction to any
// of these is recorded in workouts.edited_fields so sync stops updating it.
// pace_ms is deliberately absent: it is always derived from the effective
// distance/time_ms, never edited or synced directly.
export const C2_OWNED_COLUMNS = [
  'user_id', 'date', 'timezone', 'type', 'workout_type',
  'distance', 'time_ms', 'stroke_rate', 'stroke_count',
  'calories', 'heart_rate_avg', 'heart_rate_max', 'drag_factor',
  'comments', 'rest_distance', 'rest_time_ms',
];

export function parseEditedFields(value) {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter(f => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

export function serializeEditedFields(fields) {
  const unique = [...new Set(fields)];
  return unique.length > 0 ? JSON.stringify(unique) : null;
}

// Standard 500m-split pace in ms, matching the formula used everywhere else.
export function computePaceMs(timeMs, distance) {
  return (timeMs > 0 && distance > 0)
    ? Math.round((timeMs / distance) * 500)
    : null;
}
