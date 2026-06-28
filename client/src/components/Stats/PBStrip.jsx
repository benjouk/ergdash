import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
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

export default function PBStrip() {
  const [pbs, setPbs] = useState([]);
  const { formatPace, formatTime } = useUnits();

  useEffect(() => {
    api.getPersonalBests()
      .then(d => setPbs(d.personal_bests || []))
      .catch(() => {});
  }, []);

  if (pbs.length === 0) return null;

  return (
    <div className={styles.pbStrip}>
      {pbs.map(pb => (
        <div key={pb.distance} className={styles.pbCard}>
          <span className={styles.pbDistance}>{DISTANCE_LABELS[pb.distance] || `${pb.distance}m`}</span>
          <span className={styles.pbTime}>{formatTime(pb.time_ms)}</span>
          <span className={styles.pbPace}>{formatPace(pb.pace_ms)}</span>
          <span className={styles.pbDate}>{new Date(pb.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
        </div>
      ))}
    </div>
  );
}
