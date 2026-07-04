import { Medal } from 'lucide-react';
import styles from './PBBadge.module.css';

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

export function distanceLabel(distance) {
  return DISTANCE_LABELS[distance] || `${distance}m`;
}

export default function PBBadges({ distances = [], compact = false }) {
  if (!distances?.length) return null;

  return (
    <span className={styles.badges} aria-label="Current personal best">
      {distances.map(distance => (
        <span key={distance} className={`${styles.badge} ${compact ? styles.badgeCompact : ''}`}>
          <Medal size={compact ? 11 : 12} aria-hidden="true" />
          <span>{distanceLabel(distance)}</span>
        </span>
      ))}
    </span>
  );
}
