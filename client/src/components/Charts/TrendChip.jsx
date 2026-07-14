import styles from './Charts.module.css';

// Last-minus-first change of a numeric series key, ignoring gaps. Returns null
// when there aren't two real points to compare.
export function seriesDelta(rows, key) {
  const vals = (rows || [])
    .map(r => (typeof r === 'number' ? r : r?.[key]))
    .filter(v => v != null && Number.isFinite(v));
  if (vals.length < 2) return null;
  return vals[vals.length - 1] - vals[0];
}

// A consistent trend indicator for chart-card headers. `delta` is the signed
// change over the shown range in the metric's own units; `betterWhenUp` says
// which direction is an improvement. Colour follows the app-wide semantic
// mapping - olive = improvement, amber = regression, grey = flat - using the
// same chip tokens as the dashboard KPI chips. `children` is the pre-formatted
// magnitude to show (e.g. "1.9", "2.8s").
export default function TrendChip({ delta, betterWhenUp, children }) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const magnitude = Number(String(children).replace(/[^\d.]/g, ''));
  const flat = !(magnitude > 0);
  const up = delta > 0;
  const tone = flat ? 'flat' : (up === betterWhenUp ? 'good' : 'bad');
  const arrow = flat ? '→' : up ? '▲' : '▼';
  return (
    <span className={`${styles.trendChip} ${styles[`trend_${tone}`]}`}>
      <span aria-hidden="true">{arrow}</span>{children}
    </span>
  );
}
