import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api.js';
import { useUnits } from '../context/UnitsContext.jsx';
import PaceRibbon from '../components/PaceRibbon/PaceRibbon.jsx';
import MetricsBar from '../components/Stats/MetricsBar.jsx';

export default function Session() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workout, setWorkout] = useState(null);
  const [loading, setLoading] = useState(true);
  const { formatPace, formatDistanceFull, formatTime } = useUnits();

  useEffect(() => {
    setLoading(true);
    api.getWorkout(id)
      .then(setWorkout)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 'var(--space-6)', color: 'var(--ink-3)' }}>Loading...</div>;
  if (!workout) return <div style={{ padding: 'var(--space-6)', color: 'var(--ink-3)' }}>Workout not found</div>;

  const tag = workout.inferred_tag;
  const tagColor = tag === 'interval' ? 'var(--accent-2)' : tag === 'test' ? 'var(--hot)' : 'var(--accent)';

  const strokePaceData = workout.strokes?.length > 0
    ? workout.strokes.filter((_, i) => i % Math.max(1, Math.floor(workout.strokes.length / 200)) === 0)
        .map(s => ({ distance: Math.round(s.distance_m), pace_ms: s.pace_ms, stroke_rate: s.stroke_rate, heart_rate: s.heart_rate }))
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <button onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--ink-2)', fontSize: '0.85rem', padding: 0 }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div style={{
        display: 'flex', gap: 'var(--space-6)', alignItems: 'baseline', flexWrap: 'wrap',
        padding: 'var(--space-5)', background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-md)',
      }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>Date</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 600 }}>
            {new Date(workout.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
        <StatCell label="Distance" value={formatDistanceFull(workout.distance)} />
        <StatCell label="Time" value={formatTime(workout.time_ms)} />
        <StatCell label="Pace" value={formatPace(workout.pace_ms)} accent />
        <StatCell label="Rate" value={workout.stroke_rate ? `${workout.stroke_rate} spm` : '—'} />
        <StatCell label="Avg HR" value={workout.heart_rate_avg ? `${workout.heart_rate_avg} bpm` : '—'} />
        {tag && (
          <span style={{
            fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
            padding: '2px 8px', borderRadius: '3px', color: tagColor, background: `${tagColor}15`,
          }}>{tag}</span>
        )}
      </div>

      {workout.strokes?.length > 0 && <PaceRibbon strokes={workout.strokes} />}

      {workout.ai_note && (
        <div style={{
          padding: 'var(--space-4)', background: 'var(--accent-bg)', border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-md)', fontSize: '0.85rem', color: 'var(--ink)', lineHeight: 1.5,
        }}>
          {workout.ai_note}
        </div>
      )}

      {strokePaceData && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-4)' }}>
            Pace Over Distance
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={strokePaceData}>
              <XAxis dataKey="distance" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickFormatter={v => `${v}m`} axisLine={{ stroke: 'var(--rule)' }} tickLine={false} />
              <YAxis reversed tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickFormatter={v => formatPace(v)} axisLine={false} tickLine={false} width={55} domain={['dataMin - 1000', 'dataMax + 1000']} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }} formatter={v => [formatPace(v), 'Pace']} />
              <Line type="monotone" dataKey="pace_ms" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {strokePaceData && strokePaceData.some(d => d.stroke_rate > 0) && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-4)' }}>
            Stroke Rate
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={strokePaceData}>
              <XAxis dataKey="distance" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickFormatter={v => `${v}m`} axisLine={{ stroke: 'var(--rule)' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }} formatter={v => [v?.toFixed(1), 'spm']} />
              <Line type="monotone" dataKey="stroke_rate" stroke="var(--accent-2)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {workout.intervals?.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-4)' }}>
            Intervals
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--rule)' }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>Dist</th>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Pace</th>
                <th style={thStyle}>Rate</th>
                <th style={thStyle}>HR</th>
              </tr>
            </thead>
            <tbody>
              {workout.intervals.map((iv, i) => {
                const isBest = workout.intervals.every(other => iv.pace_ms <= other.pace_ms || other === iv);
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--rule)', background: isBest ? 'var(--accent-bg)' : 'transparent' }}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={tdStyle}>{iv.distance}m</td>
                    <td style={tdStyle}>{formatTime(iv.time_ms)}</td>
                    <td style={tdStyle}>{formatPace(iv.pace_ms)}</td>
                    <td style={tdStyle}>{iv.stroke_rate || '—'}</td>
                    <td style={tdStyle}>{iv.heart_rate_avg || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MetricsBar metrics={workout.metrics} />
    </div>
  );
}

function StatCell({ label, value, accent }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 600,
        color: accent ? 'var(--accent)' : 'var(--ink)', letterSpacing: '-0.02em',
      }}>{value}</div>
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '6px 8px', fontSize: '0.7rem', color: 'var(--ink-3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' };
const tdStyle = { padding: '6px 8px' };
