import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { ChartSkeleton } from '../Skeleton/Skeleton.jsx';
import ChartEmpty from './ChartEmpty.jsx';
import ChartInfo from './ChartInfo.jsx';
import { useChartData } from './useChartData.js';
import styles from './Charts.module.css';

const DISTANCES = [2000, 5000, 10000];
const W = 160;
const H = 72;
const PAD = 8;

// Small-multiple sparklines of the quartile pace-decay curve: the most recent
// workout at each distance against the historical (ghost) average.
function quartilePath(quartiles, min, max) {
  const range = max - min || 1;
  return ['q1', 'q2', 'q3', 'q4'].map((key, i) => {
    const x = PAD + (i / 3) * (W - PAD * 2);
    // slower pace plots lower (a fade slopes downward)
    const y = PAD + ((quartiles[key] - min) / range) * (H - PAD * 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export default function FadeFingerprint() {
  const { formatPace, formatDistance } = useUnits();
  const { data: panels = [], loading, error, retry } = useChartData(async () => {
    const results = await Promise.all(DISTANCES.map(async distance => {
      const recent = await api.getWorkouts({
        min_distance: distance, max_distance: distance, limit: 1, sort: 'date_desc',
      });
      const workout = recent.data?.[0];
      if (!workout) return null;
      const curve = await api.getDecayCurve({ distance, workout_id: workout.id });
      if (!curve.current || !curve.historical?.q1) return null;
      return { distance, date: workout.date, ...curve };
    }));

    return results.filter(Boolean);
  }, []);

  if (loading) return <ChartSkeleton />;
  if (error) return <ChartEmpty title="Fade Fingerprint" message="Couldn't load chart data." error onRetry={retry} />;
  if (panels.length === 0) return <ChartEmpty title="Fade Fingerprint" />;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Fade Fingerprint
        </div>
        <div className={styles.chartValueUnit} style={{ color: 'var(--ink-3)' }}>
          latest vs typical
        </div>
      </div>
      <div className={styles.fadeGrid}>
        {panels.map(panel => {
          const values = [
            ...Object.values(panel.historical),
            ...Object.values(panel.current),
          ].filter(v => v > 0);
          const min = Math.min(...values);
          const max = Math.max(...values);
          const fadePct = panel.current.q1 > 0
            ? ((panel.current.q4 - panel.current.q1) / panel.current.q1) * 100
            : 0;

          return (
            <div key={panel.distance} className={styles.fadePanel}>
              <div className={styles.fadeMeta}>
                <span>{formatDistance(panel.distance)}</span>
                <span style={{ color: fadePct > 2 ? 'var(--negative)' : 'var(--positive)' }}>
                  {fadePct > 0 ? '+' : ''}{fadePct.toFixed(1)}%
                </span>
              </div>
              <svg
                className={styles.fadeSvg}
                viewBox={`0 0 ${W} ${H}`}
                role="img"
                aria-label={`Pace decay for ${panel.distance}m: quartiles ${['q1', 'q2', 'q3', 'q4'].map(q => formatPace(panel.current[q])).join(', ')}`}
              >
                <rect x={0} y={0} width={W} height={H} rx={6} fill="var(--surface-2, transparent)" stroke="var(--rule)" />
                <path
                  d={quartilePath(panel.historical, min, max)}
                  fill="none"
                  stroke="var(--chart-ref)"
                  strokeWidth={1.2}
                  strokeDasharray="4 3"
                />
                <path
                  d={quartilePath(panel.current, min, max)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              </svg>
              <div className={styles.fadeAxis}>
                <span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span>
              </div>
            </div>
          );
        })}
      </div>
    
      <ChartInfo>Pace across the four quarters of your latest 2k, 5k and 10k, with your historical average as a ghost line. A flat shape means even pacing; a downward slope means fading late in the piece.</ChartInfo>
    </div>
  );
}
