import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
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

// Only frame a gap once it's meaningful (≥ ~1s off the best).
const MIN_GAP_MS = 1000;

function gapLabel(pb) {
  if (!pb.recent_time_ms || pb.recent_time_ms <= pb.time_ms + MIN_GAP_MS) return null;
  const seconds = (pb.recent_time_ms - pb.time_ms) / 1000;
  const rounded = seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1);
  return `${rounded}s from PB`;
}

export default function PBStrip() {
  const [pbs, setPbs] = useState([]);
  const [timeBests, setTimeBests] = useState([]);
  const navigate = useNavigate();
  const { formatPace, formatTime, formatDistance } = useUnits();
  const { from, to } = useTimeRange();

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
      {pbs.map(pb => {
        const gap = gapLabel(pb);
        return (
          <button
            key={pb.distance}
            type="button"
            className={styles.pbCard}
            onClick={() => navigate(`/session/${pb.workout_id}`)}
            aria-label={`Open ${DISTANCE_LABELS[pb.distance] || `${pb.distance}m`} personal best`}
          >
            <span className={styles.pbDistance}>{DISTANCE_LABELS[pb.distance] || `${pb.distance}m`}</span>
            <span className={styles.pbTime}>{formatTime(pb.time_ms)}</span>
            <span className={styles.pbPace}>{formatPace(pb.pace_ms)}</span>
            {gap
              ? <span className={styles.pbGap}>{gap}</span>
              : <span className={styles.pbDate}>{new Date(pb.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>}
          </button>
        );
      })}

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
          <span className={styles.pbDate}>{new Date(tb.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
        </button>
      ))}
    </div>
  );
}
