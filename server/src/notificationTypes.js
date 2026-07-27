// Shared notification vocabulary. Kept in its own module with no imports so
// db.js (seeding defaults), routes/settings.js (validating preferences) and
// notifications.js (emitting) can all agree on it without an import cycle.
//
// NOTIFY_KINDS must stay in step with the CHECK constraint on
// notifications.kind in migrations/020-notifications.sql.
export const NOTIFY_KINDS = [
  'plan_reminder',
  'workout_synced',
  'new_pb',
  'missed_session',
  'streak_risk',
];

export const NOTIFY_CHANNELS = ['inapp', 'push', 'webhook'];

// Deliberately outside NOTIFY_KINDS. Nobody subscribes to a test, so it must
// not appear in Settings' "What to notify" list, and asking for one explicitly
// is consent enough to bypass that filter. The kind CHECK in
// migrations/022-notification-test-kind.sql accepts it.
export const TEST_KIND = 'test';
