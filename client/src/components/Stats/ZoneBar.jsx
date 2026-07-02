import { ZONES } from '../../styles/chartTheme.js';

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Proportional five-segment strip of a session's time in each HR zone.
export default function ZoneBar({ zoneTimes }) {
  if (!zoneTimes?.length) return null;

  const total = zoneTimes.reduce((s, z) => s + z.time_s, 0);
  if (total <= 0) return null;

  const estimatedFromAvg = zoneTimes.every(z => z.source === 'avg_hr');

  return (
    <div>
      <div
        style={{
          display: 'flex',
          height: 10,
          borderRadius: 5,
          overflow: 'hidden',
          gap: 1,
        }}
        role="img"
        aria-label={`Time in HR zones: ${zoneTimes.map(z => `zone ${z.zone} ${formatDuration(z.time_s)}`).join(', ')}`}
      >
        {zoneTimes.map(z => (
          <div
            key={z.zone}
            title={`Z${z.zone}: ${formatDuration(z.time_s)} (${Math.round((z.time_s / total) * 100)}%)`}
            style={{
              width: `${(z.time_s / total) * 100}%`,
              background: ZONES[z.zone - 1],
              minWidth: 2,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 4,
          fontSize: '0.65rem',
          fontFamily: 'var(--font-mono)',
          color: 'var(--ink-3)',
        }}
      >
        <span>
          {zoneTimes.map(z => `Z${z.zone} ${Math.round((z.time_s / total) * 100)}%`).join(' · ')}
        </span>
        {estimatedFromAvg && <span title="Derived from session average HR">from avg HR</span>}
      </div>
    </div>
  );
}
