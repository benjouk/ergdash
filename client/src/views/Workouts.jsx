import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ChevronUp, ChevronDown } from 'lucide-react';
import { api } from '../api.js';
import { useUnits } from '../context/UnitsContext.jsx';

const TAGS = ['', 'endurance', 'interval', 'test', 'warmup'];

export default function Workouts() {
  const [workouts, setWorkouts] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState('date_desc');
  const [tag, setTag] = useState('');
  const navigate = useNavigate();
  const { formatPace, formatDistanceFull, formatTime } = useUnits();
  const limit = 20;

  const load = useCallback(() => {
    const params = { limit, offset, sort };
    if (tag) params.tag = tag;
    api.getWorkouts(params)
      .then(data => {
        setWorkouts(data.data || []);
        setTotal(data.meta?.total || 0);
      })
      .catch(() => {});
  }, [offset, sort, tag]);

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

  const exportCsv = () => {
    const headers = ['Date', 'Tag', 'Distance', 'Time', 'Pace', 'Rate', 'HR', 'Calories'];
    const rows = workouts.map(w => [
      w.date, w.inferred_tag || '', w.distance, formatTime(w.time_ms),
      formatPace(w.pace_ms), w.stroke_rate || '', w.heart_rate_avg || '', w.calories || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rowdash-workouts.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700,
          letterSpacing: '-0.02em', color: 'var(--ink)',
        }}>Workouts</h2>
        <button onClick={exportCsv} style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--rule)', color: 'var(--ink-2)', fontSize: '0.8rem',
          background: 'var(--surface)',
        }}>
          <Download size={14} /> Export CSV
        </button>
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
  const colors = { endurance: 'var(--accent)', interval: 'var(--accent-2)', test: 'var(--hot)', warmup: 'var(--ink-3)' };
  const color = colors[tag] || 'var(--ink-3)';
  return (
    <span style={{
      fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
      padding: '1px 5px', borderRadius: '3px', color, background: `${color}15`,
      fontFamily: 'var(--font-body)',
    }}>{tag}</span>
  );
}

const tdStyle = { padding: '8px 10px' };
const btnStyle = {
  padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--rule)', background: 'var(--surface)', color: 'var(--ink-2)',
  fontSize: '0.8rem', cursor: 'pointer',
};
