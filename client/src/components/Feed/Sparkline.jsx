import { useMemo } from 'react';

export default function Sparkline({ data, color = 'var(--accent)', width = 60, height = 18, strokeWidth = 1.2 }) {
  const path = useMemo(() => {
    if (!data || data.length < 2) return null;

    const values = data.filter(v => v > 0);
    if (values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;

    return values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      // Constant series draw as a centred flat line instead of hugging the top edge.
      const y = range === 0 ? height / 2 : ((v - min) / range) * (height - 4) + 2;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
  }, [data, width, height]);

  if (!path) return null;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  );
}
