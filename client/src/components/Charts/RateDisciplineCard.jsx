import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import Sparkline from '../Feed/Sparkline.jsx';
import styles from './Charts.module.css';

// Compact stat card: how tightly stroke rate held its band per session,
// with a sparkline of recent scores.
export default function RateDisciplineCard() {
  const [data, setData] = useState([]);
  const { from, to } = useTimeRange();

  useEffect(() => {
    const params = { metric: 'rate_discipline', period: 'all' };
    if (from) params.from = from;
    if (to) params.to = to;
    api.getTrends(params)
      .then(d => setData(d.rate_discipline_trend || []))
      .catch(() => {});
  }, [from, to]);

  if (data.length < 3) return null;

  const recent = data.slice(-20);
  const latest = recent[recent.length - 1];
  const avg = recent.reduce((s, d) => s + d.rate_discipline, 0) / recent.length;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>Rate Discipline</div>
        <div className={styles.chartValue}>
          {latest.rate_discipline.toFixed(0)}
          <span className={styles.chartValueUnit}>/100</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <Sparkline
          data={recent.map(d => d.rate_discipline)}
          color="var(--accent-2)"
          width={180}
          height={36}
          strokeWidth={1.6}
        />
        <span style={{ fontSize: '0.72rem', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
          avg {avg.toFixed(0)} over {recent.length} sessions
        </span>
      </div>
    </div>
  );
}
