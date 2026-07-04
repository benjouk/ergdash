import { useMemo } from 'react';

export default function PaceTrace({ data }) {
  const points = useMemo(() => {
    if (!data || data.length < 2) return null;

    const width = 100;
    const height = 28;
    const paces = data.map(d => d.pace_ms).filter(p => p > 0);
    if (paces.length < 2) return null;

    const min = Math.min(...paces);
    const max = Math.max(...paces);
    const range = max - min || 1;

    return paces.map((v, i) => {
      const x = (i / (paces.length - 1)) * width;
      const y = ((v - min) / range) * (height - 6) + 3;
      return `${x},${y}`;
    }).join(' ');
  }, [data]);

  if (!points) return null;

  return (
    <svg width={100} height={28} viewBox="0 0 100 28" style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke="var(--ticker-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
