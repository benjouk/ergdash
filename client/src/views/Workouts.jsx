import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ChevronUp, ChevronDown, Pin, Search, Plus, Upload, GitCompare, X } from 'lucide-react';
import { api } from '../api.js';
import { paceToWatts } from '../utils/ergMath.js';
import { useUnits } from '../context/UnitsContext.jsx';
import { useTimeRange } from '../context/TimeRangeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { usePrefs } from '../context/PrefsContext.jsx';
import Sparkline from '../components/Feed/Sparkline.jsx';
import { RowSkeleton } from '../components/Skeleton/Skeleton.jsx';
import PBBadges from '../components/PBBadge.jsx';
import WorkoutForm from '../components/Import/WorkoutForm.jsx';
import ImportPanel from '../components/Import/ImportPanel.jsx';
import styles from './Workouts.module.css';

const IS_DEMO = import.meta.env.VITE_DEMO === '1';

const TAGS = ['', 'endurance', 'interval'];
const DISTANCE_PRESETS = [
  { key: '', label: 'All', params: {} },
  { key: 'lt2k', label: '<2k', params: { max_distance: 1899 } },
  { key: '2k', label: '2k', params: { min_distance: 1900, max_distance: 2100 } },
  { key: '5k', label: '5k', params: { min_distance: 4900, max_distance: 5100 } },
  { key: '10k', label: '10k+', params: { min_distance: 9900 } },
];

const TAG_CLASS = {
  endurance: 'tagSteady',
  interval: 'tagInterval',
};

function formatWatts(paceMs) {
  const watts = paceToWatts(paceMs / 1000);
  return watts ? Math.round(watts) : '—';
}

function formatDateShort(dateStr, dateFormat) {
  const options = dateFormat === 'month-day'
    ? { month: 'short', day: 'numeric' }
    : { day: 'numeric', month: 'short' };
  return new Date(dateStr).toLocaleDateString('en-GB', options);
}

export default function Workouts() {
  const [workouts, setWorkouts] = useState([]);
  const [total, setTotal] = useState(0);
  const [filterTotals, setFilterTotals] = useState(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState('date_desc');
  const [tag, setTag] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [distancePreset, setDistancePreset] = useState('');
  const [loading, setLoading] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState([]);
  const [loadError, setLoadError] = useState('');
  // 'add' | 'import' | null — which inline panel is open above the list.
  const [panel, setPanel] = useState(null);
  const navigate = useNavigate();
  const { formatPace, formatDistanceFull, formatDistance, formatTime } = useUnits();
  const { from, to } = useTimeRange();
  const { dateFormat } = usePrefs();
  const toast = useToast();
  const limit = 20;
  const loadRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Reset on every mount so StrictMode's mount → cleanup → remount cycle
    // doesn't leave the ref permanently false.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    const params = { limit, offset, sort };
    if (tag) params.tag = tag;
    if (pinnedOnly) params.pinned = 1;
    if (q) params.q = q;
    Object.assign(params, getDistancePresetParams(distancePreset));
    if (from) params.from = from;
    if (to) params.to = to;
    setLoading(true);
    setLoadError('');
    api.getWorkouts(params)
      .then(data => {
        if (!mountedRef.current || loadRequestRef.current !== requestId) return;
        setWorkouts(data.data || []);
        setTotal(data.meta?.total || 0);
        setFilterTotals(data.meta?.totals || null);
      })
      .catch(err => {
        if (!mountedRef.current || loadRequestRef.current !== requestId) return;
        setWorkouts([]);
        setTotal(0);
        setFilterTotals(null);
        setLoadError(err.message || 'Could not load workouts');
      })
      .finally(() => {
        if (mountedRef.current && loadRequestRef.current === requestId) setLoading(false);
      });
  }, [offset, sort, tag, pinnedOnly, q, distancePreset, from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = searchInput.trim();
      setQ(previousQuery => {
        if (previousQuery === nextQuery) return previousQuery;
        setOffset(0);
        return nextQuery;
      });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const toggleSort = (field) => {
    setSort(prev => {
      if (prev === `${field}_desc`) return `${field}_asc`;
      return `${field}_desc`;
    });
    setOffset(0);
  };

  const SortIcon = ({ field }) => {
    if (sort === `${field}_desc`) return <ChevronDown size={12} />;
    if (sort === `${field}_asc`) return <ChevronUp size={12} />;
    return null;
  };

  const exportRows = useCallback(async () => {
    const pageSize = 100;
    let nextOffset = 0;
    let allRows = [];
    let expectedTotal = null;

    do {
      const params = { limit: pageSize, offset: nextOffset, sort };
      if (tag) params.tag = tag;
      if (pinnedOnly) params.pinned = 1;
      if (q) params.q = q;
      Object.assign(params, getDistancePresetParams(distancePreset));
      if (from) params.from = from;
      if (to) params.to = to;

      const data = await api.getWorkouts(params);
      const rows = data.data || [];
      // An empty page means the server has nothing more regardless of what
      // meta.total claims — bail rather than loop forever.
      if (rows.length === 0) break;
      allRows = allRows.concat(rows);
      expectedTotal = data.meta?.total ?? allRows.length;
      nextOffset += pageSize;
    } while (allRows.length < expectedTotal);

    return allRows;
  }, [sort, tag, pinnedOnly, q, distancePreset, from, to]);

  const downloadBlob = (content, type, filename) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = async () => {
    try {
      const rowsToExport = await exportRows();
      const headers = ['Date', 'Tag', 'Distance', 'Time', 'Pace', 'Rate', 'HR', 'Calories', 'Notes'];
      const rows = rowsToExport.map(w => [
        w.date, w.inferred_tag || '', w.distance, formatTime(w.time_ms),
        formatPace(w.pace_ms), w.stroke_rate || '', w.heart_rate_avg || '', w.calories || '', w.notes || '',
      ]);
      const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
      downloadBlob(csv, 'text/csv', 'ergdash-workouts.csv');
      toast.success(`Exported ${rowsToExport.length} workouts`);
    } catch (err) {
      toast.error(err.message || 'Export failed');
    }
  };

  const exportJson = async () => {
    try {
      const rowsToExport = await exportRows();
      downloadBlob(JSON.stringify({ workouts: rowsToExport }, null, 2), 'application/json', 'ergdash-workouts.json');
      toast.success(`Exported ${rowsToExport.length} workouts`);
    } catch (err) {
      toast.error(err.message || 'Export failed');
    }
  };

  const openSession = (id) => navigate(`/session/${id}`);

  const toggleComparisonWorkout = (id) => {
    setCompareSelection(current => {
      if (current.includes(id)) return current.filter(selected => selected !== id);
      if (current.length >= 2) {
        toast.error('Choose exactly two workouts');
        return current;
      }
      return [...current, id];
    });
  };

  const exitCompareMode = () => {
    setCompareMode(false);
    setCompareSelection([]);
  };

  const openComparison = () => {
    if (compareSelection.length !== 2) return;
    navigate(`/session/${compareSelection[0]}?compare=${compareSelection[1]}`);
  };

  const handleTogglePinned = async (event, workout) => {
    event.stopPropagation();
    const nextPinned = !workout.pinned;
    setWorkouts(current => current.map(w => (
      w.id === workout.id ? { ...w, pinned: nextPinned } : w
    )));

    try {
      const updated = await api.updateWorkout(workout.id, { pinned: nextPinned });
      setWorkouts(current => current.map(w => (
        w.id === workout.id ? { ...w, pinned: updated.pinned } : w
      )));
      toast.success(nextPinned ? 'Pinned' : 'Unpinned');
    } catch (err) {
      setWorkouts(current => current.map(w => (
        w.id === workout.id ? { ...w, pinned: workout.pinned } : w
      )));
      toast.error(err.message || 'Could not update pin');
    }
  };

  const handleCardKeyDown = (event, id) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openSession(id);
  };

  return (
    <div className={styles.workouts}>
      <div className={styles.header}>
        <h2 className={styles.title}>Workouts</h2>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => compareMode ? exitCompareMode() : setCompareMode(true)}
            className={`${styles.exportButton} ${compareMode ? styles.compareModeActive : ''}`}
            aria-pressed={compareMode}
          >
            {compareMode ? <X size={14} /> : <GitCompare size={14} />} {compareMode ? 'Cancel' : 'Compare'}
          </button>
          {/* Visible-but-disabled in the demo so the feature is discoverable. */}
          <button
            onClick={() => setPanel(prev => (prev === 'add' ? null : 'add'))}
            className={styles.exportButton}
            aria-expanded={panel === 'add'}
            disabled={IS_DEMO}
            title={IS_DEMO ? 'Demo mode — run ErgDash self-hosted to add workouts' : undefined}
          >
            <Plus size={14} /> Add
          </button>
          <button
            onClick={() => setPanel(prev => (prev === 'import' ? null : 'import'))}
            className={styles.exportButton}
            aria-expanded={panel === 'import'}
            disabled={IS_DEMO}
            title={IS_DEMO ? 'Demo mode — run ErgDash self-hosted to import workout files' : undefined}
          >
            <Upload size={14} /> Import
          </button>
          <button onClick={exportJson} className={styles.exportButton}>
            <Download size={14} /> JSON
          </button>
          <button onClick={exportCsv} className={styles.exportButton}>
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {panel === 'add' && (
        <WorkoutForm
          onSaved={(saved) => { setPanel(null); navigate(`/session/${saved.id}`); }}
          onCancel={() => setPanel(null)}
        />
      )}
      {panel === 'import' && (
        <ImportPanel
          onImported={() => { setPanel(null); load(); }}
          onClose={() => setPanel(null)}
        />
      )}

      <div className={styles.filters}>
        <label className={styles.searchBox}>
          <Search size={14} />
          <input
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            maxLength={100}
            placeholder="Search notes & comments"
            aria-label="Search notes and comments"
          />
        </label>
        <span className={styles.filterDivider} aria-hidden="true" />
        {TAGS.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => { setTag(t); setOffset(0); }}
            className={`${styles.filterChip} ${tag === t ? styles.filterChipActive : ''}`}
          >
            {t || 'All'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setPinnedOnly(value => !value); setOffset(0); }}
          className={`${styles.filterChip} ${pinnedOnly ? styles.filterChipActive : ''}`}
          aria-pressed={pinnedOnly}
        >
          Pinned
        </button>
        <span className={styles.filterDivider} aria-hidden="true" />
        {DISTANCE_PRESETS.map(preset => (
          <button
            key={preset.key || 'all-distance'}
            type="button"
            onClick={() => { setDistancePreset(preset.key); setOffset(0); }}
            className={`${styles.filterChip} ${distancePreset === preset.key ? styles.filterChipActive : ''}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {compareMode && (
        <div className={styles.compareTray} role="status">
          <div><GitCompare size={16} /><strong>Select two workouts</strong><span>{compareSelection.length} of 2 selected</span></div>
          <button type="button" onClick={openComparison} disabled={compareSelection.length !== 2}>Compare selected</button>
        </div>
      )}

      {loadError && (
        <div className={styles.errorBanner} role="alert">
          <span>{loadError}</span>
          <button type="button" onClick={load} className={styles.retryButton}>
            Retry
          </button>
        </div>
      )}

      {/* Desktop / tablet table */}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <Th></Th>
              <Th onClick={() => toggleSort('date')}>Date <SortIcon field="date" /></Th>
              <Th>Tag</Th>
              <Th onClick={() => toggleSort('distance')}>Distance <SortIcon field="distance" /></Th>
              <Th>Time</Th>
              <Th onClick={() => toggleSort('pace')}>Pace <SortIcon field="pace" /></Th>
              <Th>Watts</Th>
              <Th>Rate</Th>
              <Th>HR</Th>
              <Th>Cal</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, index) => (
                <RowSkeleton key={`row-skeleton-${index}`} />
              ))
            ) : workouts.map(w => (
              <tr
                key={w.id}
                tabIndex={0}
                role={compareMode ? 'checkbox' : 'link'}
                aria-checked={compareMode ? compareSelection.includes(w.id) : undefined}
                aria-label={compareMode ? `Select workout from ${formatDateShort(w.date, dateFormat)} for comparison` : `Open session from ${formatDateShort(w.date, dateFormat)}`}
                onClick={() => compareMode ? toggleComparisonWorkout(w.id) : openSession(w.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); compareMode ? toggleComparisonWorkout(w.id) : openSession(w.id); } }}
                className={`${styles.row} ${compareSelection.includes(w.id) ? styles.compareSelected : ''}`}
              >
                <td className={styles.pinCell}>
                  {compareMode ? <SelectionBox selected={compareSelection.includes(w.id)} /> : <PinButton pinned={w.pinned} onClick={event => handleTogglePinned(event, w)} />}
                </td>
                <td>{formatDateShort(w.date, dateFormat)}</td>
                <td>
                  <span className={styles.badgeStack}>
                    {w.inferred_tag && <TagBadge tag={w.inferred_tag} />}
                    {w.plan && <PlanBadge />}
                    <SourceBadge source={w.source} />
                    <PBBadges distances={w.pb_distances} compact />
                  </span>
                </td>
                <td>{formatDistanceFull(w.distance)}</td>
                <td>{formatTime(w.time_ms)}</td>
                <td className={styles.paceCell}>{formatPace(w.pace_ms)}</td>
                <td>{formatWatts(w.pace_ms)}</td>
                <td>{w.stroke_rate || '—'}</td>
                <td>{w.heart_rate_avg || '—'}</td>
                <td>{w.calories || '—'}</td>
                <td>
                  {w.pace_profile?.length >= 2 && (
                    <Sparkline
                      data={w.pace_profile}
                      color={w.inferred_tag === 'interval' ? 'var(--accent-2)' : 'var(--accent)'}
                      width={80}
                      height={20}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {filterTotals && workouts.length > 0 && (
            <tfoot>
              <tr className={styles.totalsRow}>
                <td />
                <td className={styles.totalsLabel}>Totals ({total})</td>
                <td />
                <td>{formatDistanceFull(filterTotals.distance)}</td>
                <td>{formatTime(filterTotals.time_ms)}</td>
                <td className={styles.paceCell}>{formatPace(filterTotals.avg_pace_ms)}</td>
                <td>{formatWatts(filterTotals.avg_pace_ms)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Mobile card list */}
      <div className={styles.cardList}>
        {loading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <MobileWorkoutSkeleton key={`card-skeleton-${index}`} />
          ))
        ) : workouts.map(w => (
          <div
            key={w.id}
            role={compareMode ? 'checkbox' : 'button'}
            tabIndex={0}
            className={`${styles.workoutCard} ${compareSelection.includes(w.id) ? styles.compareSelected : ''}`}
            onClick={() => compareMode ? toggleComparisonWorkout(w.id) : openSession(w.id)}
            onKeyDown={event => compareMode ? ((event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), toggleComparisonWorkout(w.id))) : handleCardKeyDown(event, w.id)}
            aria-checked={compareMode ? compareSelection.includes(w.id) : undefined}
            aria-label={compareMode ? `Select workout from ${formatDateShort(w.date, dateFormat)} for comparison` : `Open session from ${formatDateShort(w.date, dateFormat)}`}
          >
            <div className={styles.cardTop}>
              {compareMode && <SelectionBox selected={compareSelection.includes(w.id)} />}
              <span className={styles.cardDate}>{formatDateShort(w.date, dateFormat)}</span>
              <span className={styles.cardTopActions}>
                <PBBadges distances={w.pb_distances} compact />
                {w.inferred_tag && <TagBadge tag={w.inferred_tag} />}
                {w.plan && <PlanBadge />}
                <SourceBadge source={w.source} />
                {!compareMode && <PinButton pinned={w.pinned} onClick={event => handleTogglePinned(event, w)} />}
              </span>
            </div>
            <div className={styles.cardMain}>
              <span className={styles.cardPace}>{formatPace(w.pace_ms)}</span>
              {w.pace_profile?.length >= 2 && (
                <Sparkline
                  data={w.pace_profile}
                  color={w.inferred_tag === 'interval' ? 'var(--accent-2)' : 'var(--accent)'}
                  width={96}
                  height={24}
                />
              )}
            </div>
            <div className={styles.cardMeta}>
              {formatDistance(w.distance)} · {formatTime(w.time_ms)}
              {w.stroke_rate ? ` · ${w.stroke_rate}spm` : ''}
              {w.heart_rate_avg ? ` · ${w.heart_rate_avg}bpm` : ''}
            </div>
          </div>
        ))}
      </div>

      {!loading && !loadError && total > 0 && (
        <div className={styles.pagination}>
          <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
        <div className={styles.pageButtons}>
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className={styles.pageButton}
          >Previous</button>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
            className={styles.pageButton}
          >Next</button>
        </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, onClick }) {
  if (!onClick) {
    return <th><span className={styles.thLabel}>{children}</span></th>;
  }
  return (
    <th>
      <button type="button" onClick={onClick} className={styles.thButton}>{children}</button>
    </th>
  );
}

function TagBadge({ tag }) {
  const tagClass = styles[TAG_CLASS[tag]] || styles.tagOther;
  return <span className={`${styles.tag} ${tagClass}`}>{tag}</span>;
}

function PlanBadge() {
  return <span className={`${styles.tag} ${styles.tagPlan}`}>planned</span>;
}

// Marks rows that didn't come from Concept2 sync.
function SourceBadge({ source }) {
  if (!source || source === 'c2') return null;
  return <span className={`${styles.tag} ${styles.tagOther}`}>{source}</span>;
}

function PinButton({ pinned, onClick }) {
  return (
    <button
      type="button"
      className={`${styles.pinButton} ${pinned ? styles.pinButtonActive : ''}`}
      onClick={onClick}
      onKeyDown={event => event.stopPropagation()}
      aria-label={pinned ? 'Unpin workout' : 'Pin workout'}
      aria-pressed={pinned}
      title={pinned ? 'Unpin workout' : 'Pin workout'}
    >
      <Pin size={14} fill={pinned ? 'currentColor' : 'none'} />
    </button>
  );
}

function SelectionBox({ selected }) {
  return <span className={`${styles.selectionBox} ${selected ? styles.selectionBoxActive : ''}`} aria-hidden="true">
    {selected ? '✓' : ''}
  </span>;
}

function MobileWorkoutSkeleton() {
  return (
    <div className={styles.workoutCard} aria-busy="true" aria-label="Loading workout">
      <div className={styles.cardTop}>
        <span className={`${styles.skeletonBlock} ${styles.skeletonDate}`} />
        <span className={styles.cardTopActions}>
          <span className={`${styles.skeletonBlock} ${styles.skeletonTag}`} />
          <span className={`${styles.skeletonBlock} ${styles.skeletonPin}`} />
        </span>
      </div>
      <div className={styles.cardMain}>
        <span className={`${styles.skeletonBlock} ${styles.skeletonPace}`} />
        <span className={`${styles.skeletonBlock} ${styles.skeletonSpark}`} />
      </div>
      <span className={`${styles.skeletonBlock} ${styles.skeletonMeta}`} />
    </div>
  );
}

function getDistancePresetParams(key) {
  return DISTANCE_PRESETS.find(preset => preset.key === key)?.params || {};
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
