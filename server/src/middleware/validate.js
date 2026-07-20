export function isStrictDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2100) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function validateDateRange(req, res, next) {
  const { from, to } = req.query;
  const errors = [];

  if (from && !isStrictDate(from)) {
    errors.push('Invalid "from" date format. Use ISO 8601 (YYYY-MM-DD)');
  }

  if (to && !isStrictDate(to)) {
    errors.push('Invalid "to" date format. Use ISO 8601 (YYYY-MM-DD)');
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  next();
}

export function validatePaginationParams(req, res, next) {
  const { limit, offset } = req.query;
  const errors = [];

  if (limit) {
    const l = Number(limit);
    if (typeof limit !== 'string' || !Number.isInteger(l) || l < 1 || l > 1000) {
      errors.push('limit must be a number between 1 and 1000');
    }
  }

  if (offset) {
    const o = Number(offset);
    if (typeof offset !== 'string' || !Number.isInteger(o) || o < 0) {
      errors.push('offset must be a non-negative number');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  next();
}

export function validateTag(req, res, next) {
  const { tag } = req.query;
  if (tag) {
    const validTags = ['endurance', 'interval', 'test', 'warmup'];
    if (!validTags.includes(tag)) {
      return res.status(400).json({
        error: 'Invalid tag',
        details: [`tag must be one of: ${validTags.join(', ')}`],
      });
    }
  }
  next();
}

export function validateDistanceRange(req, res, next) {
  const { min_distance, max_distance } = req.query;
  const errors = [];

  if (min_distance) {
    const m = Number(min_distance);
    if (typeof min_distance !== 'string' || !Number.isInteger(m) || m < 0) {
      errors.push('min_distance must be a non-negative number');
    }
  }

  if (max_distance) {
    const m = Number(max_distance);
    if (typeof max_distance !== 'string' || !Number.isInteger(m) || m < 0) {
      errors.push('max_distance must be a non-negative number');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  next();
}

export function validateSearchQuery(req, res, next) {
  const { q } = req.query;

  if (q == null) {
    return next();
  }

  const trimmed = String(q).trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    return res.status(400).json({
      error: 'Validation failed',
      details: ['q must be between 1 and 100 characters'],
    });
  }

  req.query.q = trimmed;
  next();
}

export function validatePinnedFlag(req, res, next) {
  const { pinned } = req.query;

  if (pinned == null) {
    return next();
  }

  const valid = ['0', '1', 'true', 'false'];
  if (!valid.includes(String(pinned).toLowerCase())) {
    return res.status(400).json({
      error: 'Validation failed',
      details: ['pinned must be one of: 0, 1, true, false'],
    });
  }

  next();
}

export function validatePbFlag(req, res, next) {
  const { pb } = req.query;

  if (pb == null) {
    return next();
  }

  const valid = ['0', '1', 'true', 'false'];
  if (!valid.includes(String(pb).toLowerCase())) {
    return res.status(400).json({
      error: 'Validation failed',
      details: ['pb must be one of: 0, 1, true, false'],
    });
  }

  next();
}

export function escapeLikePattern(str) {
  return String(str).replace(/[\\%_]/g, match => `\\${match}`);
}
