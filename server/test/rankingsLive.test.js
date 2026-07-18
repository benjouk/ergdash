import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let getDb;
let initDb;
let closeDb;
let live;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-rankings-live-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  live = await import('../src/rankingsLive.js');
  ({ getDb, initDb, closeDb } = dbModule);

  initDb();
  db = getDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

const NOW = new Date('2026-07-18T12:00:00Z');

function formatTime(totalSeconds) {
  const tenths = Math.round(totalSeconds * 10);
  const s = Math.floor(tenths / 10);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = h > 0 ? String(m % 60).padStart(2, '0') : String(m);
  const ss = String(s % 60).padStart(2, '0');
  const prefix = h > 0 ? `${h}:${mm}` : mm;
  return `${prefix}:${ss}.${tenths % 10}`;
}

// A representative rankings page: header row, then one row per rank with the
// result in the final column, plus the "1 - 50 of N" summary.
function rankingsPage({ page, perPage = 50, total, valueForRank }) {
  const first = (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);
  let rows = '';
  for (let rank = first; rank <= last; rank++) {
    rows += `<tr><td>${rank.toLocaleString('en-US')}</td><td><a href="/profile/1">Rower ${rank}</a></td>` +
      `<td>34</td><td>Somewhere</td><td>USA</td><td>${valueForRank(rank)}</td></tr>\n`;
  }
  return `<html><body>
    <table class="table">
      <thead><tr><th>Pos.</th><th>Name</th><th>Age</th><th>Location</th><th>Country</th><th>Time</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary">${first.toLocaleString('en-US')} - ${last.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}</div>
  </body></html>`;
}

// Mock fetch serving generated pages for any &page=N, slower times at higher
// ranks: rank 1 rows 6:00.0 and every rank adds 0.05s.
function mockRankingsFetch({ total = 2000, event = 'd2000' } = {}) {
  const valueForRank = event.startsWith('t')
    ? rank => Math.round(9000 - rank).toLocaleString('en-US')
    : rank => formatTime(360 + rank * 0.05);

  return vi.fn(async (url) => {
    const page = Number(new URL(url).searchParams.get('page') || '1');
    return {
      ok: true,
      text: async () => rankingsPage({ page, total, valueForRank }),
    };
  });
}

describe('completedRankingSeason', () => {
  it('names seasons by ending year and uses the last completed one', () => {
    expect(live.completedRankingSeason(new Date('2026-07-18T00:00:00Z'))).toBe(2026);
    expect(live.completedRankingSeason(new Date('2026-02-01T00:00:00Z'))).toBe(2025);
    expect(live.completedRankingSeason(new Date('2026-05-01T00:00:00Z'))).toBe(2026);
  });
});

describe('bucketFor', () => {
  it('builds the ranking URL with gender, age, and weight filters', () => {
    const bucket = live.bucketFor('d2000', { sex: 'M', age: 37, weightKg: 90 }, 2026);
    expect(bucket.key).toBe('2026|d2000|M|30-39|hwt');
    expect(bucket.url).toContain('/rankings/2026/rower/2000?');
    expect(bucket.url).toContain('gender=M');
    expect(bucket.url).toContain('age=30-39');
    expect(bucket.url).toContain('weight=H');
  });

  it('maps fixed-time events to minute slugs and 70+ to a bounded range', () => {
    const bucket = live.bucketFor('t1800', { sex: 'F', age: 74, weightKg: 60 }, 2026);
    expect(bucket.url).toContain('/rankings/2026/rower/30?');
    expect(bucket.url).toContain('age=70-99');
    expect(bucket.url).toContain('weight=L');
  });

  it('omits the age filter when age is unknown', () => {
    const bucket = live.bucketFor('d2000', { sex: 'M', age: null, weightKg: null }, 2026);
    expect(bucket.key).toBe('2026|d2000|M|all|hwt');
    expect(bucket.url).not.toContain('age=');
  });

  it('rejects unranked events', () => {
    expect(live.bucketFor('d1234', { sex: 'M', age: 30, weightKg: 80 }, 2026)).toBeNull();
  });
});

describe('parsing', () => {
  it('reads the total entry count from the pagination summary', () => {
    const html = rankingsPage({ page: 1, total: 12345, valueForRank: () => '6:05.4' });
    expect(live.parseTotalEntries(html)).toBe(12345);
    expect(live.parseTotalEntries('<html>no numbers here</html>')).toBeNull();
  });

  it('extracts position and time for distance events, skipping header rows', () => {
    const html = rankingsPage({ page: 1, total: 60, valueForRank: rank => formatTime(360 + rank) });
    const rows = live.parseRankingRows(html, 'd2000');
    expect(rows).toHaveLength(50);
    expect(rows[0]).toEqual({ position: 1, value: '6:01.0' });
    expect(rows[49].position).toBe(50);
  });

  it('extracts metres for fixed-time events without confusing age or position', () => {
    const html = rankingsPage({ page: 1, total: 60, valueForRank: rank => (9000 - rank).toLocaleString('en-US') });
    const rows = live.parseRankingRows(html, 't1800');
    expect(rows[0]).toEqual({ position: 1, value: '8,999' });
  });

  it('converts values to pace seconds per 500m', () => {
    expect(live.valueToPaceS('d2000', '6:00.0')).toBeCloseTo(90, 5);
    expect(live.valueToPaceS('d21097', '1:25:26.0')).toBeCloseTo((85 * 60 + 26) / (21097 / 500), 3);
    expect(live.valueToPaceS('t1800', '8,205')).toBeCloseTo(1800 / (8205 / 500), 3);
    expect(live.valueToPaceS('d2000', 'not a time')).toBeNull();
  });
});

describe('fetchBucketAnchors', () => {
  it('fetches anchor pages at rank offsets and returns a monotonic curve', async () => {
    const fetchFn = mockRankingsFetch({ total: 2000 });
    const bucket = live.bucketFor('d2000', { sex: 'M', age: 37, weightKg: 90 }, 2026);
    const { total, anchors } = await live.fetchBucketAnchors(bucket, { fetchFn, delayMs: 0 });

    expect(total).toBe(2000);
    expect(anchors.map(([pct]) => pct)).toEqual(live.ANCHOR_PERCENTILES);
    // p99 -> rank 20 -> 6:01.0 -> 90.25s pace; p50 -> rank 1000 -> 410s -> 102.5s.
    expect(anchors[0][1]).toBeCloseTo((360 + 20 * 0.05) / 4, 2);
    expect(anchors[4][1]).toBeCloseTo((360 + 1000 * 0.05) / 4, 2);
    for (let i = 1; i < anchors.length; i++) {
      expect(anchors[i][1]).toBeGreaterThanOrEqual(anchors[i - 1][1]);
    }
    // Distinct pages only: page 1 plus the pages the anchor ranks land on.
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it('rejects pages it cannot parse', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, text: async () => '<html>maintenance</html>' }));
    const bucket = live.bucketFor('d2000', { sex: 'M', age: 37, weightKg: 90 }, 2026);
    await expect(live.fetchBucketAnchors(bucket, { fetchFn, delayMs: 0 })).rejects.toThrow(/Unparseable/);
  });

  it('propagates HTTP failures', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 403 }));
    const bucket = live.bucketFor('d2000', { sex: 'M', age: 37, weightKg: 90 }, 2026);
    await expect(live.fetchBucketAnchors(bucket, { fetchFn, delayMs: 0 })).rejects.toThrow(/403/);
  });
});

describe('refreshRankingPercentiles + liveBenchmark', () => {
  function seedAthlete() {
    const settings = db.prepare('INSERT OR REPLACE INTO settings (profile_id, key, value) VALUES (1, ?, ?)');
    settings.run('sex', 'M');
    settings.run('birth_year', '1989');
    settings.run('weight_kg', '90');
    db.prepare(`
      INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, distance, time_ms, pace_ms, synced_at)
      VALUES (10, 1, 1, '2026-07-01 07:00:00', 'rower', 'FixedDistanceSplits', 2000, 400000, 100000, datetime('now'))
    `).run();
  }

  it('caches reconciled buckets and serves live benchmarks from them', async () => {
    seedAthlete();
    const fetchFn = mockRankingsFetch({ total: 2000 });

    const summary = await live.refreshRankingPercentiles({ now: NOW, fetchFn, delayMs: 0 });
    expect(summary).toMatchObject({ refreshed: 1, fresh: 0, failed: 0 });

    const cached = live.getCachedBucket(db, '2026|d2000|M|30-39|hwt');
    expect(cached.total_entries).toBe(2000);
    expect(cached.anchors).toHaveLength(live.ANCHOR_PERCENTILES.length);

    const athlete = { sex: 'M', age: 37, weightKg: 90 };
    // 100s pace sits between p99 (90.25s) and p50 (102.5s) in the mock data.
    const benchmark = live.liveBenchmark(db, { event: 'd2000', paceMs: 100000, athlete, now: NOW });
    expect(benchmark.source).toBe('live');
    expect(benchmark.approximate).toBe(false);
    expect(benchmark.n).toBe(2000);
    expect(benchmark.season).toBe(2026);
    expect(benchmark.percentile).toBeGreaterThan(50);
    expect(benchmark.percentile).toBeLessThan(99);
  });

  it('skips fresh buckets and refetches stale ones', async () => {
    seedAthlete();
    const fetchFn = mockRankingsFetch({ total: 2000 });

    await live.refreshRankingPercentiles({ now: NOW, fetchFn, delayMs: 0 });
    const callsAfterFirst = fetchFn.mock.calls.length;

    const second = await live.refreshRankingPercentiles({ now: NOW, fetchFn, delayMs: 0 });
    expect(second).toMatchObject({ refreshed: 0, fresh: 1 });
    expect(fetchFn.mock.calls.length).toBe(callsAfterFirst);

    const later = new Date(NOW.getTime() + 8 * 86400000);
    const third = await live.refreshRankingPercentiles({ now: later, fetchFn, delayMs: 0 });
    expect(third).toMatchObject({ refreshed: 1, fresh: 0 });
  });

  it('records failures without aborting and leaves no cache row', async () => {
    seedAthlete();
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500 }));

    const summary = await live.refreshRankingPercentiles({ now: NOW, fetchFn, delayMs: 0 });
    expect(summary).toMatchObject({ refreshed: 0, failed: 1 });
    expect(live.getCachedBucket(db, '2026|d2000|M|30-39|hwt')).toBeNull();

    const athlete = { sex: 'M', age: 37, weightKg: 90 };
    expect(live.liveBenchmark(db, { event: 'd2000', paceMs: 100000, athlete, now: NOW })).toBeNull();
  });

  it('does nothing for profiles without an athlete sex', async () => {
    db.prepare(`
      INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, distance, time_ms, pace_ms, synced_at)
      VALUES (10, 1, 1, '2026-07-01 07:00:00', 'rower', 'FixedDistanceSplits', 2000, 400000, 100000, datetime('now'))
    `).run();
    const fetchFn = mockRankingsFetch({});
    const summary = await live.refreshRankingPercentiles({ now: NOW, fetchFn, delayMs: 0 });
    expect(summary).toMatchObject({ refreshed: 0, fresh: 0, failed: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
