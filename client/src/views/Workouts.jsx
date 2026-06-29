import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ChevronUp, ChevronDown } from 'lucide-react';
import { api } from '../api.js';
import { useUnits } from '../context/UnitsContext.jsx';
import { useTimeRange } from '../context/TimeRangeContext.jsx';
import Sparkline from '../components/Feed/Sparkline.jsx';

const TAGS = ['', 'endurance', 'interval'];

export default function Workouts() {
  const [workouts, setWorkouts] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState('date_desc');
  const [tag, setTag] = useState('');
  const navigate = useNavigate();
  const { formatPace, formatDistanceFull, formatTime } = useUnits();
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700,
          letterSpacing: '-0.02em', color: 'var(--ink)',
        }}>Workouts</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={exportJson} style={exportBtnStyle}>
            <Download size={14} /> JSON
          </button>
          <button onClick={exportCsv} style={exportBtnStyle}>
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {TAGS.map(t => (
          <button key={t} onClick={() => { setTag(t); setOffset(0); }} style={{
            padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem', fontWeight: 500,
            background: tag === t ? 'var(--accent)' : 'var(--surface)',
            color: tag === t ? '#fff' : 'var(--ink-2)',
            border: `1px solid ${tag === t ? 'var(--accent)' : 'var(--rule)'}`,
          }}>
            {t || 'All'}
          </button>
        ))}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--rule)' }}>
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
              <tr key={w.id} onClick={() => navigate(`/session/${w.id}`)} style={{ borderBottom: '1px solid var(--rule)', cursor: 'pointer' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--surface-alt)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                <td style={tdStyle}>{new Date(w.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                <td style={tdStyle}>
                  {w.inferred_tag && <TagBadge tag={w.inferred_tag} />}
                </td>
                <td style={tdStyle}>{formatDistanceFull(w.distance)}</td>
                <td style={tdStyle}>{formatTime(w.time_ms)}</td>
                <td style={{ ...tdStyle, color: 'var(--accent)', fontWeight: 600 }}>{formatPace(w.pace_ms)}</td>
                <td style={tdStyle}>{w.stroke_rate || '—'}</td>
                <td style={tdStyle}>{w.heart_rate_avg || '—'}</td>
                <td style={tdStyle}>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--ink-2)' }}>
        <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
            style={{ ...btnStyle, opacity: offset === 0 ? 0.3 : 1 }}>Previous</button>
          <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total}
            style={{ ...btnStyle, opacity: offset + limit >= total ? 0.3 : 1 }}>Next</button>
        </div>
      </div>
    </div>
  );
}

function Th({ children, onClick }) {
  return (
    <th onClick={onClick} style={{
      textAlign: 'left', padding: '8px 10px', fontSize: '0.7rem', color: 'var(--ink-3)',
      fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
      cursor: onClick ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap',
    }}>{children}</th>
  );
}

function TagBadge({ tag }) {
  const colors = {
    endurance: 'var(--accent)',
    interval: 'var(--accent-2)',
  };
  const color = colors[tag] || 'var(--ink-3)';
  return (
    <span style={{
      fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
      padding: '1px 5px', borderRadius: '3px', color, background: `${color}15`,
      fontFamily: 'var(--font-body)',
    }}>{tag}</span>
  );
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const tdStyle = { padding: '8px 10px' };
const btnStyle = {
  padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--rule)', background: 'var(--surface)', color: 'var(--ink-2)',
  fontSize: '0.8rem', cursor: 'pointer',
};
const exportBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--rule)', color: 'var(--ink-2)', fontSize: '0.8rem',
  background: 'var(--surface)',
};
