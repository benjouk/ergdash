import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useProfileQuery } from '../../hooks/useProfileQuery.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { usePrefs } from '../../context/PrefsContext.jsx';
import { weightAdjusted, weightAdjustedDistance } from '../../utils/ergMath.js';
import styles from './Stats.module.css';

const DISTANCE_LABELS = {
  500: '500m',
  1000: '1k',
  2000: '2k',
  5000: '5k',
  6000: '6k',
  10000: '10k',
  21097: 'HM',
  42195: 'FM',
};

const TIME_LABELS = {
  1800: '30 min',
  3600: '60 min',
};

// "top 18% · M 30-39 Hwt" - standing in the ranked erg population for the
// athlete's class. Reconciled buckets (source 'live') come from the real
// Concept2 season rankings; the bundled estimate keeps a "~" prefix.
function benchmarkLabel(benchmark) {
  const cls = [
    benchmark.sex,
    benchmark.age_band,
    benchmark.weight_class === 'lwt' ? 'Lwt' : 'Hwt',
  ].filter(Boolean).join(' ');
  const prefix = benchmark.source === 'live' ? 'top' : '~top';
  return `${prefix} ${benchmark.top_percent}% · ${cls}`;
}

function benchmarkTitle(benchmark) {
  if (benchmark.source === 'live') {
    const ranked = typeof benchmark.n === 'number' ? ` (${benchmark.n.toLocaleString()} ranked)` : '';
    return `Percentile from the Concept2 ${benchmark.season} season rankings${ranked}`;
  }
  return 'Estimated percentile among ranked ergs for your class';
}

export default function PBStrip() {
  const navigate = useNavigate();
  const { formatPace, formatTime, formatDistance } = useUnits();
  const { from, to } = useTimeRange();
  const { weightKg } = usePrefs();

  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const { data, error, loading, refetch } = useProfileQuery(
    ['stats', 'personal-bests', params],
    () => api.getPersonalBests(params)
  );
  const pbs = data?.personal_bests || [];
  const timeBests = data?.time_bests || [];

  if (loading) return null;
  if (error) {
    return (
      <div className={styles.pbState} role="alert">
        <span>Couldn't load personal bests.</span>
        <button type="button" onClick={() => refetch().catch(() => {})}>Retry</button>
      </div>
    );
  }
  if (pbs.length === 0 && timeBests.length === 0) {
    return <div className={styles.pbState}>No personal bests in this period yet.</div>;
  }

  return (
    <div className={styles.pbStrip}>
      {pbs.map(pb => (
        <button
          key={`${pb.distance}_${pb.tag || 'endurance'}`}
          type="button"
          className={styles.pbCard}
          onClick={() => navigate(`/session/${pb.workout_id}`)}
          aria-label={`Open ${DISTANCE_LABELS[pb.distance] || `${pb.distance}m`}${pb.tag === 'interval' ? ' interval' : ''} personal best`}
        >
          <span className={styles.pbDistance}>
            {DISTANCE_LABELS[pb.distance] || `${pb.distance}m`}
            {pb.tag === 'interval' && <span className={styles.pbTag}> int</span>}
          </span>
          <span className={styles.pbTime}>{formatTime(pb.time_ms)}</span>
          <span className={styles.pbPace}>{formatPace(pb.pace_ms)}</span>
          {weightKg && (
            <span className={styles.pbAdjusted}>wt adj {formatTime(Math.round(weightAdjusted(pb.time_ms, weightKg)))}</span>
          )}
          {pb.benchmark && (
            <span className={styles.pbRank} title={benchmarkTitle(pb.benchmark)}>
              {benchmarkLabel(pb.benchmark)}
            </span>
          )}
          <span className={styles.pbDate}>{new Date(pb.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
        </button>
      ))}

      {timeBests.map(tb => (
        <button
          key={`t${tb.duration_s}`}
          type="button"
          className={styles.pbCard}
          onClick={() => navigate(`/session/${tb.workout_id}`)}
          aria-label={`Open ${TIME_LABELS[tb.duration_s] || `${tb.duration_s}s`} personal best`}
        >
          <span className={styles.pbDistance}>{TIME_LABELS[tb.duration_s] || `${tb.duration_s}s`}</span>
          <span className={styles.pbTime}>{formatDistance(tb.distance)}</span>
          <span className={styles.pbPace}>{formatPace(tb.pace_ms)}</span>
          {weightKg && (
            <span className={styles.pbAdjusted}>wt adj {formatDistance(Math.round(weightAdjustedDistance(tb.distance, weightKg)))}</span>
          )}
          {tb.benchmark && (
            <span className={styles.pbRank} title={benchmarkTitle(tb.benchmark)}>
              {benchmarkLabel(tb.benchmark)}
            </span>
          )}
          <span className={styles.pbDate}>{new Date(tb.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
        </button>
      ))}
    </div>
  );
}
