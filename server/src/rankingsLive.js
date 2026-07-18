// Reconciles the bundled percentile model against the real Concept2 season
// rankings at log.concept2.com/rankings. For each (season, event, sex, age
// band, weight class) bucket an athlete's PBs fall into, this fetches a
// handful of ranking pages at computed rank offsets, reads the times found
// there as percentile anchors, and caches the curve in ranking_percentiles.
// Benchmarks then interpolate against the real distribution; the bundled
// model in rankings.js remains the fallback whenever no cached curve exists
// (offline instance, fetch failure, or a page-format change the parser
// rejects). Everything here degrades to "no cache row" - it must never take
// the app down.
//
// The rankings have no official API, so this scrapes public HTML politely:
// sequential requests, a delay between every page, one refresh per bucket
// per week, and only the buckets the household's athletes actually need.
// Verify the URL/parse against the live site with:
//   node scripts/fetch-rankings.mjs d2000 M 30-39 hwt

import cron from 'node-cron';
import { getDb } from './db.js';
import { athleteFromSettings, ageBand, weightClass, interpolatePercentile } from './rankings.js';
import { STANDARD_PB_DISTANCES } from './pbDetection.js';

const RANKINGS_BASE = process.env.C2_RANKINGS_BASE || 'https://log.concept2.com';

// Ranking URL slugs per event key: distance events use metres, fixed-time
// events use minutes (https://log.concept2.com/rankings/<season>/rower/<slug>).
const EVENT_SLUGS = {
  d500: '500',
  d1000: '1000',
  d2000: '2000',
  d5000: '5000',
  d6000: '6000',
  d10000: '10000',
  d21097: '21097',
  d42195: '42195',
  t1800: '30',
  t3600: '60',
};

// Fixed-time events rank by distance covered; converting to pace needs the
// piece duration.
const EVENT_DURATION_S = { t1800: 1800, t3600: 3600 };

export const ANCHOR_PERCENTILES = [99, 95, 90, 75, 50, 25, 10, 5];

const CACHE_MAX_AGE_DAYS = 7;
const FETCH_DELAY_MS = 1500;
const USER_AGENT = 'ErgDash (self-hosted; +https://github.com/benjouk/ergdash)';

// Concept2 seasons run May 1 - April 30 and are named by the ending year.
// The current season is thin for its first months, so percentiles come from
// the most recent COMPLETED season.
export function completedRankingSeason(now = new Date()) {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 4 ? y : y - 1;
}

// The rankings' age filter wants an explicit range; the open-ended 70+ band
// maps to the widest range the form accepts.
function ageParam(band) {
  if (!band) return null;
  return band === '70+' ? '70-99' : band;
}

export function bucketFor(event, athlete, season) {
  const slug = EVENT_SLUGS[event];
  if (!slug || !athlete?.sex) return null;

  const band = ageBand(athlete.age);
  const wclass = weightClass(athlete.sex, athlete.weightKg);
  const params = new URLSearchParams({ gender: athlete.sex });
  const age = ageParam(band);
  if (age) params.set('age', age);
  params.set('weight', wclass === 'lwt' ? 'L' : 'H');

  return {
    key: `${season}|${event}|${athlete.sex}|${band || 'all'}|${wclass}`,
    event,
    season,
    sex: athlete.sex,
    age_band: band,
    weight_class: wclass,
    url: `${RANKINGS_BASE}/rankings/${season}/rower/${slug}?${params}`,
  };
}

// --- HTML parsing (deliberately tolerant; any anomaly returns null/throws
// and the bucket simply stays on the bundled model) ---

// Total ranked entries, from the "1 - 50 of 12,345" style summary the
// rankings pages render near the pagination.
export function parseTotalEntries(html) {
  const patterns = [
    /of\s+([\d,]+)\s+(?:entries|results|rows)/i,
    /([\d,]+)\s+total/i,
    /of\s+<[^>]*>\s*([\d,]+)/i,
    /\d[\d,]*\s*-\s*\d[\d,]*\s+of\s+([\d,]+)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isInteger(n) && n > 0) return n;
    }
  }
  return null;
}

const TIME_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\.(\d)$/;

function timeToSeconds(text) {
  const m = text.match(TIME_RE);
  if (!m) return null;
  const [, h, min, s, tenths] = m;
  return (h ? Number(h) * 3600 : 0) + Number(min) * 60 + Number(s) + Number(tenths) / 10;
}

// Ranking rows as { position, value } where value is the result cell text.
// Distance events list a time ("6:05.4", "1:25:26.0"); fixed-time events list
// metres ("8,205"). Cells are located by content, not column index, so the
// parser survives cosmetic column changes.
export function parseRankingRows(html, event) {
  const isTimeEvent = event in EVENT_DURATION_S;
  const rows = [];

  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(c => c[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
    if (cells.length < 2) continue;

    const position = /^\d[\d,]*$/.test(cells[0]) ? Number(cells[0].replace(/,/g, '')) : null;
    if (position == null) continue;

    let value = null;
    if (isTimeEvent) {
      // Metres covered: a standalone number that cannot be the position or an
      // age column. 1,000m in 30 minutes is already implausibly slow.
      value = cells.slice(1).find(c => {
        if (!/^\d{1,3}(?:,\d{3})+$|^\d{4,6}$/.test(c)) return false;
        const metres = Number(c.replace(/,/g, ''));
        return metres >= 1000 && metres <= 40000;
      }) || null;
    } else {
      value = cells.slice(1).find(c => TIME_RE.test(c)) || null;
    }

    if (value != null) rows.push({ position, value });
  }

  return rows;
}

export function valueToPaceS(event, value) {
  const duration = EVENT_DURATION_S[event];
  if (duration != null) {
    const metres = Number(String(value).replace(/,/g, ''));
    if (!Number.isFinite(metres) || metres <= 0) return null;
    return duration / (metres / 500);
  }

  const distance = Number(EVENT_SLUGS[event]);
  const seconds = timeToSeconds(String(value));
  if (seconds == null || !Number.isFinite(distance) || distance <= 0) return null;
  return seconds / (distance / 500);
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPage(url, fetchFn) {
  const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

// Fetches one bucket's percentile anchors: page 1 gives the total entry count
// and page size; each anchor percentile maps to a rank, each rank to a page,
// and the time found at that rank becomes the anchor pace.
export async function fetchBucketAnchors(bucket, { fetchFn = fetch, delayMs = FETCH_DELAY_MS } = {}) {
  const firstHtml = await fetchPage(bucket.url, fetchFn);
  const total = parseTotalEntries(firstHtml);
  const firstRows = parseRankingRows(firstHtml, bucket.event);

  if (!total || firstRows.length === 0) {
    throw new Error(`Unparseable rankings page for ${bucket.key} (total=${total}, rows=${firstRows.length})`);
  }

  const perPage = firstRows.length;
  const pages = new Map([[1, firstRows]]);

  const targets = ANCHOR_PERCENTILES.map(pct => ({
    pct,
    rank: Math.min(total, Math.max(1, Math.round((total * (100 - pct)) / 100))),
  }));

  for (const target of targets) {
    const pageNo = Math.ceil(target.rank / perPage);
    if (pages.has(pageNo)) continue;
    await delay(delayMs);
    const html = await fetchPage(`${bucket.url}&page=${pageNo}`, fetchFn);
    const rows = parseRankingRows(html, bucket.event);
    if (rows.length === 0) throw new Error(`Empty rankings page ${pageNo} for ${bucket.key}`);
    pages.set(pageNo, rows);
  }

  const anchors = [];
  for (const target of targets) {
    const pageNo = Math.ceil(target.rank / perPage);
    const rows = pages.get(pageNo);
    const row = rows.find(r => r.position === target.rank) || rows[Math.min(rows.length - 1, (target.rank - 1) % perPage)];
    const paceS = row ? valueToPaceS(bucket.event, row.value) : null;
    if (paceS == null) throw new Error(`No usable result at rank ${target.rank} for ${bucket.key}`);
    anchors.push([target.pct, Math.round(paceS * 100) / 100]);
  }

  // A real distribution is monotonic; anything else means the parse read the
  // wrong cells, and the bucket is better left on the bundled model.
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i][1] < anchors[i - 1][1]) {
      throw new Error(`Non-monotonic anchors for ${bucket.key}`);
    }
  }

  return { total, anchors };
}

// --- cache + refresh ---

export function getCachedBucket(db, bucketKey) {
  const row = db.prepare('SELECT * FROM ranking_percentiles WHERE bucket = ?').get(bucketKey);
  if (!row) return null;
  try {
    return { ...row, anchors: JSON.parse(row.anchors_json) };
  } catch {
    return null;
  }
}

// Live benchmark for one PB, served entirely from the cache (never fetches).
// Returns null when the bucket has not been reconciled, letting the caller
// fall back to the bundled model.
export function liveBenchmark(db, { event, paceMs, athlete, now = new Date() }) {
  const bucket = bucketFor(event, athlete, completedRankingSeason(now));
  if (!bucket) return null;

  const cached = getCachedBucket(db, bucket.key);
  if (!cached) return null;

  const percentile = interpolatePercentile(cached.anchors, paceMs / 1000);
  if (percentile == null) return null;

  return {
    percentile,
    top_percent: Math.max(1, 100 - percentile),
    sex: bucket.sex,
    age_band: bucket.age_band,
    weight_class: bucket.weight_class,
    approximate: false,
    source: 'live',
    season: cached.season,
    n: cached.total_entries,
  };
}

// Events this profile actually has benchmarkable results for.
function eventsForProfile(db, profileId) {
  const events = new Set();
  const distances = db.prepare(`
    SELECT DISTINCT distance FROM workouts
    WHERE type = 'rower' AND profile_id = ? AND pace_ms > 0
      AND (inferred_tag IS NULL OR inferred_tag != 'interval')
  `).all(profileId);
  for (const { distance } of distances) {
    if (STANDARD_PB_DISTANCES.includes(distance)) events.add(`d${distance}`);
  }

  const durations = db.prepare(`
    SELECT DISTINCT be.duration_s FROM best_efforts be
    JOIN workouts w ON w.id = be.workout_id
    WHERE w.profile_id = ? AND be.duration_s IN (1800, 3600) AND be.avg_pace_ms > 0
  `).all(profileId);
  for (const { duration_s } of durations) events.add(`t${duration_s}`);

  return [...events];
}

function isFresh(row, now) {
  if (!row?.fetched_at) return false;
  return now.getTime() - Date.parse(row.fetched_at) < CACHE_MAX_AGE_DAYS * 86400000;
}

// Refreshes every stale bucket the household's athletes need. Sequential and
// throttled; each bucket failure is logged and skipped so one bad page never
// blocks the rest.
export async function refreshRankingPercentiles({ now = new Date(), fetchFn = fetch, delayMs = FETCH_DELAY_MS, force = false } = {}) {
  const db = getDb();
  const season = completedRankingSeason(now);

  const buckets = new Map();
  const profiles = db.prepare('SELECT id FROM profiles').all();
  for (const { id } of profiles) {
    const rows = db.prepare('SELECT key, value FROM settings WHERE profile_id = ?').all(id);
    const athlete = athleteFromSettings(Object.fromEntries(rows.map(r => [r.key, r.value])), now);
    if (!athlete) continue;
    for (const event of eventsForProfile(db, id)) {
      const bucket = bucketFor(event, athlete, season);
      if (bucket) buckets.set(bucket.key, bucket);
    }
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO ranking_percentiles (bucket, season, total_entries, anchors_json, fetched_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const summary = { refreshed: 0, fresh: 0, failed: 0 };
  for (const bucket of buckets.values()) {
    if (!force && isFresh(db.prepare('SELECT fetched_at FROM ranking_percentiles WHERE bucket = ?').get(bucket.key), now)) {
      summary.fresh += 1;
      continue;
    }
    try {
      const { total, anchors } = await fetchBucketAnchors(bucket, { fetchFn, delayMs });
      upsert.run(bucket.key, bucket.season, total, JSON.stringify(anchors), now.toISOString());
      summary.refreshed += 1;
      console.log(`[rankings] Reconciled ${bucket.key} (${total} entries)`);
    } catch (err) {
      summary.failed += 1;
      console.warn(`[rankings] ${err.message} - keeping bundled estimate for this bucket`);
    }
    await delay(delayMs);
  }

  return summary;
}

let refreshScheduleStarted = false;

// Daily reconciliation, plus one shortly after boot so a fresh install shows
// real percentiles the same day the athlete profile is filled in. Disabled
// with ERGDASH_RANKINGS_LIVE=0 for instances that must not make outbound
// requests beyond Concept2 sync.
export function startRankingRefreshSchedule() {
  if (refreshScheduleStarted) return;
  if (process.env.ERGDASH_RANKINGS_LIVE === '0') {
    console.log('Live rankings reconciliation disabled (ERGDASH_RANKINGS_LIVE=0)');
    return;
  }
  refreshScheduleStarted = true;

  setTimeout(() => {
    refreshRankingPercentiles().catch(err => console.warn('[rankings] Initial reconcile failed:', err.message));
  }, 45000);

  cron.schedule('30 4 * * *', () => {
    refreshRankingPercentiles().catch(err => console.warn('[rankings] Scheduled reconcile failed:', err.message));
  });
}
