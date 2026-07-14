import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'ergdash.db');

let db;

export function getDb() {
  if (!db) throw new Error('Database not initialized - call initDb() first');
  return db;
}

export function initDb() {
  mkdirSync(DATA_DIR, { recursive: true });

  if (db?.open) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  for (const { id } of db.prepare('SELECT id FROM profiles').all()) {
    seedDefaultSettings(db, id);
  }

  return db;
}

export function closeDb() {
  if (!db) return;
  if (db.open) db.close();
  db = undefined;
}

export function reopenDb() {
  closeDb();
  return initDb();
}

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
  );

  const migrationsDir = join(__dirname, '..', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    })();
    console.log(`Migration applied: ${file}`);
  }
}

export function seedDefaultSettings(db, profileId) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (profile_id, key, value) VALUES (?, ?, ?)'
  );
  db.transaction(() => {
    insert.run(profileId, 'theme', 'system');
    insert.run(profileId, 'units', 'pace');
    insert.run(profileId, 'sync_interval', '15');
    insert.run(profileId, 'default_landing', '/');
    insert.run(profileId, 'feed_limit', '50');
    insert.run(profileId, 'week_start', 'monday');
    insert.run(profileId, 'date_format', 'day-month');
  })();
}

export function getDbPath() {
  return DB_PATH;
}

export function getDataDir() {
  return DATA_DIR;
}
