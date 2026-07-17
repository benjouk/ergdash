// Full ErgDash data backup + restore, scoped to a single household profile.
//
// Unlike the file Import feature (which acquires workouts from external
// CSV/TCX/FIT files, summary-level, with dedup/merge), this moves ErgDash's
// own complete state between installs: every table that belongs to a profile,
// with all columns. A backup taken on one install and restored on a clean one
// reproduces the profile exactly - no Concept2 re-sync required, so it works
// fully offline.
//
// Faithfulness hinges on ids being preserved. workouts.id is the Concept2
// result id for synced rows (always positive) or a negative id for
// manual/imported rows, and programs.id is a stable autoincrement key. Restore
// keeps both verbatim, so every child foreign key (strokes.workout_id,
// planned_workouts.program_id/completed_workout_id, ...) stays valid with no
// remapping. The only value rewritten is profile_id -> the target profile.
import { getDb } from './db.js';

// Bump only on an incompatible change to the file shape. A restore refuses a
// file whose version is newer than it understands.
export const BACKUP_VERSION = 1;

// Every per-profile table, in foreign-key-safe insert order (a table never
// appears before one it references). `scope` is how a row ties to a profile:
//   'profile' - the table has a profile_id column
//   'workout' - the table ties to a profile through workout_id -> workouts.id
export const BACKUP_TABLES = [
  { name: 'workouts', scope: 'profile' },
  { name: 'intervals', scope: 'workout' },
  { name: 'strokes', scope: 'workout' },
  { name: 'computed_metrics', scope: 'workout' },
  { name: 'hr_zone_time', scope: 'workout' },
  { name: 'best_efforts', scope: 'workout' },
  { name: 'interval_recoveries', scope: 'workout' },
  { name: 'programs', scope: 'profile' },
  { name: 'planned_workouts', scope: 'profile' },
  { name: 'pb_history', scope: 'profile' },
  { name: 'fitness_log', scope: 'profile' },
  { name: 'predictions', scope: 'profile' },
  { name: 'goals', scope: 'profile' },
  { name: 'settings', scope: 'profile' },
];

const WORKOUT_SCOPE_SQL = 'workout_id IN (SELECT id FROM workouts WHERE profile_id = ?)';

function selectSql({ name, scope }) {
  const where = scope === 'workout' ? WORKOUT_SCOPE_SQL : 'profile_id = ?';
  return `SELECT * FROM ${name} WHERE ${where}`;
}

// Live column names for a table, so restore only writes columns this install's
// schema actually has (tolerant of a backup taken on a slightly older/newer
// schema).
function tableColumns(db, name) {
  return db.prepare(`PRAGMA table_info(${name})`).all().map(col => col.name);
}

// Stream one table's rows for a profile without buffering them all - the
// strokes table can hold hundreds of thousands of rows. Yields row objects.
export function* iterateProfileTable(db, table, profileId) {
  yield* db.prepare(selectSql(table)).iterate(profileId);
}

// Build the complete in-memory backup object for a profile. Used by the tests
// and small datasets; the HTTP route streams the same shape for large ones.
export function exportProfileData(db, profileId) {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    tables[table.name] = db.prepare(selectSql(table)).all(profileId);
  }
  return {
    ergdash_backup_version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    profile_id: profileId,
    tables,
  };
}

export function isValidBackup(backup) {
  return !!backup
    && typeof backup === 'object'
    && Number.isInteger(backup.ergdash_backup_version)
    && !!backup.tables
    && typeof backup.tables === 'object';
}

// Delete a profile's existing rows across every backup table, so a restore is
// a clean replace rather than a merge. Children are cleared before parents
// (reverse insert order) so it holds even with foreign keys enforced.
export function clearProfileData(db, profileId) {
  for (const table of [...BACKUP_TABLES].reverse()) {
    const where = table.scope === 'workout' ? WORKOUT_SCOPE_SQL : 'profile_id = ?';
    db.prepare(`DELETE FROM ${table.name} WHERE ${where}`).run(profileId);
  }
}

function insertRows(db, name, rows, profileId, scope) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const liveCols = tableColumns(db, name);
  if (liveCols.length === 0) return 0;
  const hasProfileCol = scope === 'profile' && liveCols.includes('profile_id');

  // Columns to write: the live schema's columns that the backup row carries.
  // profile_id is always forced to the target profile below.
  const cols = liveCols.filter(col => rows[0] && Object.prototype.hasOwnProperty.call(rows[0], col));
  const stmt = db.prepare(
    `INSERT INTO ${name} (${cols.map(c => `"${c}"`).join(', ')}) `
    + `VALUES (${cols.map(() => '?').join(', ')})`,
  );

  let inserted = 0;
  for (const row of rows) {
    const values = cols.map(col => (hasProfileCol && col === 'profile_id' ? profileId : row[col]));
    stmt.run(...values);
    inserted += 1;
  }
  return inserted;
}

// Restore a backup file's data under `profileId`, replacing that profile's
// current data. Preserves original row ids and rewrites profile_id to the
// target. Runs in a single transaction (all-or-nothing). Returns per-table
// inserted row counts. Throws on a malformed or too-new backup.
export function restoreProfileData(db, profileId, backup) {
  if (!isValidBackup(backup)) {
    throw new Error('Not a valid ErgDash backup file');
  }
  if (backup.ergdash_backup_version > BACKUP_VERSION) {
    throw new Error(
      `This backup was made by a newer version of ErgDash `
      + `(format v${backup.ergdash_backup_version}). Update ErgDash before restoring.`,
    );
  }

  const counts = {};
  db.transaction(() => {
    clearProfileData(db, profileId);
    for (const table of BACKUP_TABLES) {
      counts[table.name] = insertRows(db, table.name, backup.tables[table.name], profileId, table.scope);
    }
  })();
  return counts;
}

// Convenience wrapper for callers holding only a profile id.
export function restoreProfileBackup(profileId, backup) {
  return restoreProfileData(getDb(), profileId, backup);
}
