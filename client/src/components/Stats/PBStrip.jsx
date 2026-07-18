import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
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

// "~top 18% · M 30-39 Hwt" - estimated standing in the ranked erg population
// for the athlete's class (see server/src/rankings.js; approximate by design).
function benchmarkLabel(benchmark) {
  const cls = [
    benchmark.sex,
    benchmark.age_band,
    benchmark.weight_class === 'lwt' ? 'Lwt' : 'Hwt',
  ].filter(Boolean).join(' ');
  return `~top ${benchmark.top_percent}% · ${cls}`;
}

export default function PBStrip() {
  const [pbs, setPbs] = useState([]);
  const [timeBests, setTimeBests] = useState([]);
  const navigate = useNavigate();
  const { formatPace, formatTime, formatDistance } = useUnits();
  const { from, to } = useTimeRange();
  const { weightKg } = usePrefs();

  useEffect(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    api.getPersonalBests(params)
      .then(d => {
        setPbs(d.personal_bests || []);
        setTimeBests(d.time_bests || []);
      })
      .catch(() => {});
  }, [from, to]);

  if (pbs.length === 0 && timeBests.length === 0) return null;

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
            <span className={styles.pbRank} title="Estimated percentile among ranked ergs for your class">
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
            <span className={styles.pbRank} title="Estimated percentile among ranked ergs for your class">
              {benchmarkLabel(tb.benchmark)}
            </span>
          )}
          <span className={styles.pbDate}>{new Date(tb.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
        </button>
      ))}
    </div>
  );
}
