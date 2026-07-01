import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ChevronUp, ChevronDown } from 'lucide-react';
import { api } from '../api.js';
import { useUnits } from '../context/UnitsContext.jsx';
import { useTimeRange } from '../context/TimeRangeContext.jsx';
import Sparkline from '../components/Feed/Sparkline.jsx';
import styles from './Workouts.module.css';

const TAGS = ['', 'endurance', 'interval'];

const TAG_CLASS = {
  endurance: 'tagSteady',
  interval: 'tagInterval',
};

function formatDateShort(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function Workouts() {
  const [workouts, setWorkouts] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState('date_desc');
  const [tag, setTag] = useState('');
  const navigate = useNavigate();
  const { formatPace, formatDistanceFull, formatDistance, formatTime } = useUnits();
  const { from, to } = useTimeRange();
  const limit = 20;

  const load = useCallback(() => {
    const params = { limit, offset, sort };
    if (tag) params.tag = tag;
    if (from) params.from = from;
    if (to) params.to = to;
    api.getWorkouts(params)
      .then(data => {
        setWorkouts(data.data || []);
        setTotal(data.meta?.total || 0);
      })
      .catch(() => {});
  }, [offset, sort, tag, from, to]);

  useEffect(() => { load(); }, [load]);

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
      if (from) params.from = from;
      if (to) params.to = to;

      const data = await api.getWorkouts(params);
      const rows = data.data || [];
      allRows = allRows.concat(rows);
      expectedTotal = data.meta?.total ?? allRows.length;
      nextOffset += pageSize;
    } while (allRows.length < expectedTotal);

    return allRows;
  }, [sort, tag, from, to]);

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
    const rowsToExport = await exportRows();
    const headers = ['Date', 'Tag', 'Distance', 'Time', 'Pace', 'Rate', 'HR', 'Calories'];
    const rows = rowsToExport.map(w => [
      w.date, w.inferred_tag || '', w.distance, formatTime(w.time_ms),
      formatPace(w.pace_ms), w.stroke_rate || '', w.heart_rate_avg || '', w.calories || '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    downloadBlob(csv, 'text/csv', 'rowdash-workouts.csv');
  };

  const exportJson = async () => {
    const rowsToExport = await exportRows();
    downloadBlob(JSON.stringify({ workouts: rowsToExport }, null, 2), 'application/json', 'rowdash-workouts.json');
  };

  const openSession = (id) => navigate(`/session/${id}`);

  return (
    <div className={styles.workouts}>
      <div className={styles.header}>
        <h2 className={styles.title}>Workouts</h2>
        <div className={styles.actions}>
          <button onClick={exportJson} className={styles.exportButton}>
            <Download size={14} /> JSON
          </button>
          <button onClick={exportCsv} className={styles.exportButton}>
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      <div className={styles.filters}>
        {TAGS.map(t => (
          <button
            key={t}
            onClick={() => { setTag(t); setOffset(0); }}
            className={`${styles.filterChip} ${tag === t ? styles.filterChipActive : ''}`}
          >
            {t || 'All'}
          </button>
        ))}
      </div>

      {/* Desktop / tablet table */}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <Th onClick={() => toggleSort('date')}>Date <SortIcon field="date" /></Th>
              <Th>Tag</Th>
              <Th onClick={() => toggleSort('distance')}>Distance <SortIcon field="distance" /></Th>
              <Th>Time</Th>
              <Th onClick={() => toggleSort('pace')}>Pace <SortIcon field="pace" /></Th>
              <Th>Rate</Th>
              <Th>HR</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {workouts.map(w => (
              <tr
                key={w.id}
                tabIndex={0}
                role="link"
                aria-label={`Open session from ${formatDateShort(w.date)}`}
                onClick={() => openSession(w.id)}
                onKeyDown={e => { if (e.key === 'Enter') openSession(w.id); }}
                className={styles.row}
              >
                <td>{formatDateShort(w.date)}</td>
                <td>
                  {w.inferred_tag && <TagBadge tag={w.inferred_tag} />}
                </td>
                <td>{formatDistanceFull(w.distance)}</td>
                <td>{formatTime(w.time_ms)}</td>
                <td className={styles.paceCell}>{formatPace(w.pace_ms)}</td>
                <td>{w.stroke_rate || '—'}</td>
                <td>{w.heart_rate_avg || '—'}</td>
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
        </table>
      </div>

      {/* Mobile card list */}
      <div className={styles.cardList}>
        {workouts.map(w => (
          <button
            key={w.id}
            type="button"
            className={styles.workoutCard}
            onClick={() => openSession(w.id)}
            aria-label={`Open session from ${formatDateShort(w.date)}`}
          >
            <div className={styles.cardTop}>
              <span className={styles.cardDate}>{formatDateShort(w.date)}</span>
              {w.inferred_tag && <TagBadge tag={w.inferred_tag} />}
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
          </button>
        ))}
      </div>

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

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
