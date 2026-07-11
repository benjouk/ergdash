import { Fragment, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useUnits } from '../../context/UnitsContext.jsx';
import btn from '../ui/Button.module.css';
import styles from './ImportPanel.module.css';

const FORMAT_BY_EXT = { csv: 'csv', tcx: 'tcx', fit: 'fit' };

const ACTION_LABELS = {
  new: 'Import as new',
  merge: 'Merge into existing',
  skip: 'Skip',
};

function statusBadge(row) {
  if (!row.validation.ok) return { className: styles.badgeInvalid, label: `Invalid: ${row.validation.errors[0]}` };
  const dup = row.duplicate;
  if (!dup) return { className: styles.badgeNew, label: 'New' };
  if (dup.status === 'already_imported') return { className: styles.badgeSkip, label: 'Already imported' };
  if (dup.status === 'exact') return { className: styles.badgeMerge, label: `Duplicate of #${dup.match_id}` };
  return { className: styles.badgeLikely, label: `Likely duplicate of #${dup.match_id}` };
}

// File import with a mandatory preview: parse server-side, review every row
// (status, per-row action), then commit. Nothing is written until commit.
export default function ImportPanel({ onImported, onClose }) {
  const toast = useToast();
  const { formatDistanceFull, formatPace, formatTime } = useUnits();
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [actions, setActions] = useState({});
  const [expanded, setExpanded] = useState(null);

  const pickFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();
    const format = FORMAT_BY_EXT[ext];
    if (!format) {
      toast.error('Choose a .csv, .tcx or .fit file');
      return;
    }

    setBusy(true);
    try {
      const data = await api.previewImport(file, format);
      setPreview(data);
      setActions(Object.fromEntries(data.workouts.map(row => [row.index, row.suggested_action])));
      setExpanded(null);
    } catch (err) {
      toast.error(err.message || 'Could not read file');
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const result = { new: 0, merge: 0, skip: 0 };
    if (!preview) return result;
    for (const row of preview.workouts) {
      const action = row.validation.ok ? (actions[row.index] || 'skip') : 'skip';
      result[action] += 1;
    }
    return result;
  }, [preview, actions]);

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const payload = {
        fingerprint_base: preview.fingerprint_base,
        workouts: preview.workouts.map(row => {
          const action = row.validation.ok ? (actions[row.index] || 'skip') : 'skip';
          const entry = { index: row.index, action };
          if (action !== 'skip') entry.normalized = row.normalized;
          if (action === 'merge') entry.target_id = row.duplicate?.match_id;
          return entry;
        }),
      };
      const result = await api.commitImport(payload);
      const okCount = result.created.length + result.merged.length;
      if (okCount > 0) {
        toast.success(`Imported ${result.created.length} new, merged ${result.merged.length}`);
      }
      result.errors.forEach(e => toast.error(`Row ${e.index + 1}: ${e.error}`));
      if (result.errors.length === 0) {
        setPreview(null);
        onImported?.();
      }
    } catch (err) {
      toast.error(err.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const cancelPreview = () => {
    setPreview(null);
    setActions({});
    setExpanded(null);
  };

  return (
    <div className={styles.panel}>
      {!preview && (
        <div className={styles.picker}>
          <p className={styles.hint}>
            Import rows from a Concept2 Logbook CSV export, an ErgData / PM5 file
            (.fit), or a TCX activity. You&apos;ll review everything before it&apos;s saved.
          </p>
          <div className={styles.pickerActions}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tcx,.fit"
              onChange={pickFile}
              className={styles.fileInput}
              aria-label="Choose workout file"
              disabled={busy}
            />
            <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={onClose}>
              Close
            </button>
          </div>
          {busy && <p className={styles.hint}>Reading file…</p>}
        </div>
      )}

      {preview && (
        <>
          <div className={styles.previewHeader}>
            <strong>{preview.filename}</strong>
            <span className={styles.hint}>
              {preview.workouts.length} workout{preview.workouts.length === 1 ? '' : 's'} found — review before saving
            </span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Distance</th>
                  <th>Time</th>
                  <th>Pace</th>
                  <th>HR</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {preview.workouts.map(row => {
                  const badge = statusBadge(row);
                  const n = row.normalized;
                  const action = row.validation.ok ? (actions[row.index] || 'skip') : 'skip';
                  const isExpanded = expanded === row.index;
                  return (
                    <Fragment key={row.index}>
                      <tr
                        className={styles.row}
                        onClick={() => setExpanded(isExpanded ? null : row.index)}
                      >
                        <td>{n.date ? n.date.slice(0, 16) : '—'}</td>
                        <td>{n.distance ? formatDistanceFull(n.distance) : '—'}</td>
                        <td>{n.time_ms ? formatTime(n.time_ms) : '—'}</td>
                        <td>{n.pace_ms ? formatPace(n.pace_ms) : '—'}</td>
                        <td>{n.heart_rate_avg || '—'}</td>
                        <td><span className={`${styles.badge} ${badge.className}`}>{badge.label}</span></td>
                        <td onClick={e => e.stopPropagation()}>
                          <select
                            className={styles.actionSelect}
                            value={action}
                            disabled={!row.validation.ok}
                            aria-label={`Action for row ${row.index + 1}`}
                            onChange={e => setActions(prev => ({ ...prev, [row.index]: e.target.value }))}
                          >
                            {Object.entries(ACTION_LABELS).map(([value, label]) => (
                              <option
                                key={value}
                                value={value}
                                disabled={value === 'merge' && !row.duplicate}
                              >
                                {label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className={styles.detailRow}>
                          <td colSpan={7}>
                            <div className={styles.detail}>
                              <div>
                                <strong>Parsed:</strong>{' '}
                                rate {n.stroke_rate ?? '—'} · max HR {n.heart_rate_max ?? '—'} ·
                                drag {n.drag_factor ?? '—'} · cal {n.calories ?? '—'} ·
                                splits {n.intervals?.length ?? 0} · samples {n.samples_count ?? 0}
                                {n.comments ? ` · "${n.comments}"` : ''}
                              </div>
                              {row.validation.warnings.length > 0 && (
                                <div className={styles.warning}>{row.validation.warnings.join('; ')}</div>
                              )}
                              {row.duplicate && row.duplicate.status !== 'already_imported' && (
                                <div>
                                  <strong>Existing #{row.duplicate.match_id}</strong>{' '}
                                  ({row.duplicate.existing.source}): {row.duplicate.existing.date?.slice(0, 16)} ·{' '}
                                  {formatDistanceFull(row.duplicate.existing.distance)} · {formatTime(row.duplicate.existing.time_ms)}
                                  {row.duplicate.mergeable && (
                                    <div className={styles.hint}>
                                      Merge fills: {[
                                        ...row.duplicate.mergeable.fields,
                                        row.duplicate.mergeable.strokes ? 'stroke data' : null,
                                        row.duplicate.mergeable.intervals ? 'splits' : null,
                                      ].filter(Boolean).join(', ') || 'nothing (already complete)'}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.footer}>
            <span className={styles.hint}>
              Import {counts.new} new · merge {counts.merge} · skip {counts.skip}
            </span>
            <div className={styles.footerActions}>
              <button
                type="button"
                className={`${btn.button} ${btn.buttonPrimary} ${btn.buttonSmall}`}
                onClick={commit}
                disabled={busy || counts.new + counts.merge === 0}
              >
                {busy ? 'Importing…' : `Import ${counts.new + counts.merge} workout${counts.new + counts.merge === 1 ? '' : 's'}`}
              </button>
              <button type="button" className={`${btn.button} ${btn.buttonSmall}`} onClick={cancelPreview} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
