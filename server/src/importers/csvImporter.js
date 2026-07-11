// CSV import: the Concept2 Logbook season export and a lenient generic
// format. Column matching is header-alias based, never positional, so both
// dialects (and reasonable training-log spreadsheets) parse with one map.
import { parse } from 'csv-parse/sync';
import { formatLocalDate } from './normalize.js';

// Maps a canonical field to the header spellings that mean it. Headers are
// compared lowercased with whitespace collapsed.
const HEADER_ALIASES = {
  c2_log_id: ['log id', 'id'],
  date: ['date', 'workout date', 'day'],
  time_s: ['work time (seconds)', 'time (seconds)', 'seconds', 'duration (seconds)'],
  time_text: ['work time (formatted)', 'work time', 'time', 'duration'],
  distance: ['work distance', 'distance', 'meters', 'distance (m)'],
  stroke_rate: ['stroke rate/cadence', 'stroke rate', 'avg stroke rate', 'spm', 'rate'],
  stroke_count: ['stroke count', 'strokes'],
  pace: ['pace', 'avg pace', 'split', 'avg split'],
  calories: ['total cal', 'calories', 'total calories', 'cal'],
  heart_rate_avg: ['avg heart rate', 'average heart rate', 'heart rate', 'avg hr', 'hr'],
  heart_rate_max: ['max heart rate', 'max hr'],
  drag_factor: ['drag factor', 'drag'],
  type: ['type', 'erg type', 'machine'],
  comments: ['comments', 'notes', 'description'],
};

function normalizeHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildColumnMap(headers) {
  const normalized = headers.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    // Aliases are listed best-first, so "Comments" beats "Description" even
    // when the Description column appears earlier in the file.
    for (const alias of aliases) {
      const index = normalized.indexOf(alias);
      if (index !== -1) {
        map[field] = index;
        break;
      }
    }
  }
  return map;
}

function cell(row, map, field) {
  const index = map[field];
  if (index === undefined) return null;
  const value = String(row[index] ?? '').trim();
  return value === '' ? null : value;
}

function toInt(value) {
  if (value === null) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toFloat(value) {
  if (value === null) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// "6:52.3", "1:02:15", "412.5" (seconds) → ms.
export function parseDurationMs(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Math.round(Number(text) * 1000);
  }
  const match = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

// Accepts "2026-07-10 06:30:00", ISO with T/Z, and "10/07/2026"-style dates
// are rejected (ambiguous day/month) — the preview shows the row error.
function parseCsvDate(value) {
  if (!value) return null;
  const text = value.trim();
  const isoLike = text.match(/^(\d{4}-\d{2}-\d{2})([T ](\d{2}:\d{2}(:\d{2})?))?/);
  if (!isoLike) return null;
  const time = isoLike[3] ? (isoLike[3].length === 5 ? `${isoLike[3]}:00` : isoLike[3]) : '00:00:00';
  return `${isoLike[1]} ${time}`;
}

// Whether a C2 export row is from a rowing erg. Files without a Type column
// are assumed rowing (this is a rowing dashboard).
function isRowerRow(typeValue) {
  if (!typeValue) return true;
  return typeValue.toLowerCase().includes('row');
}

export function parseCsv(buffer, filename) {
  const workouts = [];
  const fileErrors = [];

  let records;
  try {
    records = parse(buffer, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });
  } catch (err) {
    return { workouts, errors: [`CSV parse failed: ${err.message}`] };
  }

  if (records.length < 2) {
    return { workouts, errors: ['CSV has no data rows'] };
  }

  const map = buildColumnMap(records[0]);
  if (map.date === undefined) {
    return { workouts, errors: ['CSV is missing a recognizable date column'] };
  }
  if (map.distance === undefined) {
    return { workouts, errors: ['CSV is missing a recognizable distance column'] };
  }

  records.slice(1).forEach((row, rowIndex) => {
    const type = cell(row, map, 'type');
    if (!isRowerRow(type)) return; // silently skip Ski/Bike rows in C2 exports

    const date = parseCsvDate(cell(row, map, 'date'));
    const distance = toInt(cell(row, map, 'distance'));

    let timeMs = null;
    const timeSeconds = toFloat(cell(row, map, 'time_s'));
    if (timeSeconds !== null) {
      timeMs = Math.round(timeSeconds * 1000);
    } else {
      timeMs = parseDurationMs(cell(row, map, 'time_text'));
    }
    // Last resort: back-compute time from a per-500m pace column.
    if (timeMs === null && distance) {
      const paceMs = parseDurationMs(cell(row, map, 'pace'));
      if (paceMs !== null) {
        timeMs = Math.round((paceMs * distance) / 500);
      }
    }

    workouts.push({
      date,
      timezone: null,
      workout_type: 'JustRow',
      distance,
      time_ms: timeMs,
      stroke_rate: toFloat(cell(row, map, 'stroke_rate')),
      stroke_count: toInt(cell(row, map, 'stroke_count')),
      calories: toInt(cell(row, map, 'calories')),
      heart_rate_avg: toInt(cell(row, map, 'heart_rate_avg')),
      heart_rate_max: toInt(cell(row, map, 'heart_rate_max')),
      drag_factor: toInt(cell(row, map, 'drag_factor')),
      comments: cell(row, map, 'comments'),
      intervals: null,
      samples: [],
      source_meta: {
        format: 'csv',
        filename,
        row_index: rowIndex,
        c2_log_id: toInt(cell(row, map, 'c2_log_id')),
      },
    });
  });

  if (workouts.length === 0) {
    fileErrors.push('No rowing workouts found in CSV');
  }
  return { workouts, errors: fileErrors };
}

export { formatLocalDate };
