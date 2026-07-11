// File import: POST /preview parses an uploaded CSV/TCX/FIT file and returns
// normalized workouts + duplicate analysis without writing anything; POST
// /commit takes the (client-reviewed) rows back and writes them. The preview
// is stateless — no staging table — so commit re-validates everything.
import express, { Router } from 'express';
import { createHash } from 'crypto';
import { getDb } from '../db.js';
import { parseCsv } from '../importers/csvImporter.js';
import { parseTcx } from '../importers/tcxImporter.js';
import { parseFit } from '../importers/fitImporter.js';
import {
  validateNormalized,
  insertNormalizedWorkout,
  withDerivedPace,
} from '../importers/normalize.js';
import {
  findDuplicate,
  computeMergeable,
  mergeIntoExisting,
  resolveMergeTarget,
} from '../importers/dedup.js';
import { runPostSyncAnalytics } from '../sync.js';

const router = Router();

const PARSERS = {
  csv: parseCsv,
  tcx: parseTcx,
  fit: parseFit,
};

const MAX_PREVIEW_SAMPLES = 10000;

function detectFormat(req) {
  const explicit = String(req.query.format || '').toLowerCase();
  if (PARSERS[explicit]) return explicit;
  const filename = String(req.query.filename || '').toLowerCase();
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1) : '';
  return PARSERS[ext] ? ext : null;
}

// Keep echoed sample arrays bounded: beyond 10k points, thin evenly. The
// charts bucket to a couple hundred points anyway.
function downsample(samples) {
  if (!Array.isArray(samples) || samples.length <= MAX_PREVIEW_SAMPLES) return samples;
  const step = Math.ceil(samples.length / MAX_PREVIEW_SAMPLES);
  return samples.filter((_, index) => index % step === 0);
}

function rowFingerprint(base, index) {
  return `${base}:${index}`;
}

router.post(
  '/preview',
  express.raw({ type: '*/*', limit: '50mb' }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const format = detectFormat(req);
    if (!format) {
      return res.status(400).json({ error: 'Unknown file format — expected .csv, .tcx or .fit' });
    }

    const filename = String(req.query.filename || `upload.${format}`);
    const { workouts, errors } = PARSERS[format](req.body, filename);
    if (workouts.length === 0) {
      return res.status(400).json({ error: errors[0] || 'No workouts found in file' });
    }

    const db = getDb();
    const fingerprintBase = createHash('sha256').update(req.body).digest('hex');

    const rows = workouts.map((workout, index) => {
      const normalized = withDerivedPace({
        ...workout,
        samples: downsample(workout.samples),
      });
      const validation = validateNormalized(normalized);

      let duplicate = null;
      if (validation.ok) {
        const found = findDuplicate(db, normalized, rowFingerprint(fingerprintBase, index), req.profileId);
        if (found) {
          const mergeable = found.status === 'already_imported'
            ? null
            : computeMergeable(db, found.match, normalized);
          duplicate = {
            status: found.status,
            match_id: found.match.id,
            matched_on: found.matched_on,
            existing: {
              id: found.match.id,
              date: found.match.date,
              distance: found.match.distance,
              time_ms: found.match.time_ms,
              pace_ms: found.match.pace_ms,
              source: found.match.source,
              has_stroke_data: !!found.match.has_stroke_data,
              heart_rate_avg: found.match.heart_rate_avg,
              drag_factor: found.match.drag_factor,
            },
            mergeable,
          };
        }
      }

      let suggestedAction = 'new';
      if (!validation.ok || duplicate?.status === 'already_imported') {
        suggestedAction = 'skip';
      } else if (duplicate) {
        suggestedAction = 'merge';
      }

      return {
        index,
        normalized: { ...normalized, samples_count: workout.samples?.length || 0 },
        validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings },
        duplicate,
        suggested_action: suggestedAction,
      };
    });

    res.json({
      format,
      filename,
      fingerprint_base: fingerprintBase,
      file_errors: errors,
      workouts: rows,
    });
  }
);

router.post(
  '/commit',
  express.json({ limit: '25mb' }),
  (req, res) => {
    const body = req.body || {};
    const fingerprintBase = body.fingerprint_base;
    if (typeof fingerprintBase !== 'string' || !/^[a-f0-9]{16,128}$/i.test(fingerprintBase)) {
      return res.status(400).json({ error: 'fingerprint_base missing or invalid' });
    }
    if (!Array.isArray(body.workouts) || body.workouts.length === 0) {
      return res.status(400).json({ error: 'workouts array is required' });
    }
    if (body.workouts.length > 2000) {
      return res.status(400).json({ error: 'workouts cannot exceed 2000 entries' });
    }

    const db = getDb();
    const created = [];
    const merged = [];
    const errors = [];
    let skipped = 0;

    for (const row of body.workouts) {
      const index = Number(row?.index);
      const action = row?.action;
      if (!Number.isInteger(index) || index < 0) {
        errors.push({ index: row?.index ?? null, error: 'invalid row index' });
        continue;
      }
      if (action === 'skip') {
        skipped += 1;
        continue;
      }
      if (action !== 'new' && action !== 'merge') {
        errors.push({ index, error: "action must be 'new', 'merge' or 'skip'" });
        continue;
      }

      // The preview payload is round-tripped through the client, so treat it
      // as untrusted: full re-validation, fresh duplicate/fingerprint checks.
      const fingerprint = rowFingerprint(fingerprintBase, index);
      try {
        const already = db.prepare(
          'SELECT id FROM workouts WHERE import_fingerprint = ? AND profile_id = ?'
        ).get(fingerprint, req.profileId);
        if (already) {
          errors.push({ index, error: `already imported (workout ${already.id})` });
          continue;
        }

        const normalized = row.normalized;
        const validation = validateNormalized(normalized || {});
        if (!validation.ok) {
          errors.push({ index, error: validation.errors.join('; ') });
          continue;
        }

        if (action === 'new') {
          created.push(insertNormalizedWorkout(db, normalized, fingerprint, req.profileId));
        } else {
          // Re-run duplicate detection rather than trusting the echoed
          // target_id — merging must only ever hit the row this import
          // actually duplicates.
          const resolved = resolveMergeTarget(db, normalized, fingerprint, Number(row.target_id), req.profileId);
          if (resolved.error) {
            errors.push({ index, error: resolved.error });
            continue;
          }
          mergeIntoExisting(db, resolved.target, normalized, fingerprint);
          merged.push(resolved.target.id);
        }
      } catch (err) {
        errors.push({ index, error: err.message });
      }
    }

    if (created.length > 0 || merged.length > 0) {
      runPostSyncAnalytics(req.profileId, created, merged, []);
    }

    res.json({ created, merged, skipped, errors });
  }
);

export default router;
