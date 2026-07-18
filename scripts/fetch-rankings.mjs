#!/usr/bin/env node
// Verifies live rankings reconciliation against the real Concept2 site from
// a machine with normal internet access (the fetcher in
// server/src/rankingsLive.js runs unattended, so check the URL and parser
// here first when in doubt).
//
//   node scripts/fetch-rankings.mjs <event> <sex> [age] [weight] [season]
//   node scripts/fetch-rankings.mjs d2000 M 30-39 hwt
//   node scripts/fetch-rankings.mjs t1800 F
//
// event: d500 d1000 d2000 d5000 d6000 d10000 d21097 d42195 t1800 t3600

import { bucketFor, fetchBucketAnchors, completedRankingSeason } from '../server/src/rankingsLive.js';

const [event, sex, age = null, weight = null, seasonArg = null] = process.argv.slice(2);

if (!event || !['M', 'F'].includes(sex)) {
  console.error('Usage: node scripts/fetch-rankings.mjs <event> <M|F> [age-band] [hwt|lwt] [season]');
  process.exit(1);
}

const athlete = {
  sex,
  // bucketFor buckets by numeric age; the midpoint of the requested band
  // lands in that band.
  age: age ? Number(age.split('-')[0]) + 2 : null,
  // Any weight on the correct side of the class cutoff selects the class.
  weightKg: weight === 'lwt' ? 60 : null,
};

const season = seasonArg ? Number(seasonArg) : completedRankingSeason();
const bucket = bucketFor(event, athlete, season);
console.log(`Bucket:  ${bucket.key}`);
console.log(`URL:     ${bucket.url}`);

try {
  const { total, anchors } = await fetchBucketAnchors(bucket, { delayMs: 1500 });
  console.log(`Entries: ${total.toLocaleString()}`);
  console.log('Percentile anchors (pace s/500m):');
  for (const [pct, paceS] of anchors) {
    const m = Math.floor(paceS / 60);
    const s = (paceS % 60).toFixed(1).padStart(4, '0');
    console.log(`  p${String(pct).padEnd(3)} ${m}:${s}`);
  }
} catch (err) {
  console.error(`Fetch/parse failed: ${err.message}`);
  console.error('The live site may differ from what the parser expects - the app will keep using the bundled estimates.');
  process.exit(2);
}
