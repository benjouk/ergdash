import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import Sparkline from './Sparkline.jsx';
import styles from './Feed.module.css';

function formatRelativeDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffHours = diffMs / 3600000;
  const diffDays = diffMs / 86400000;

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffDays < 2) return 'Yesterday';
  if (diffDays < 7) return `${Math.floor(diffDays)}d ago`;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const TAG_CLASS = {
  endurance: styles.tagSteady,
  interval: styles.tagInterval,
};

function workoutTitle(w) {
  const dist = w.distance >= 1000 ? `${(w.distance / 1000).toFixed(w.distance % 1000 === 0 ? 0 : 1)}k` : `${w.distance}m`;
  if (w.inferred_tag === 'interval') return `${dist} intervals`;
  return `${dist} endurance`;
}

export default function FeedPanel() {
  const [workouts, setWorkouts] = useState([]);
  const params = useParams();
  const { formatPace, formatDistance, formatTime } = useUnits();
  const { from, to } = useTimeRange();

  useEffect(() => {
    const p = { limit: 50, sort: 'date_desc' };
    if (from) p.from = from;
    if (to) p.to = to;
    api.getWorkouts(p)
      .then(data => setWorkouts(data.data || []))
      .catch(() => {});
  }, [from, to]);

  if (workouts.length === 0) return (
    <div className={styles.feed}>
      <div className={styles.feedHeader}>Recent Sessions</div>
      <div style={{ padding: 'var(--space-4)', color: 'var(--ink-3)', fontSize: '0.8rem' }}>No workouts yet</div>
    </div>
  );

  return (
    <div className={styles.feed}>
      <div className={styles.feedHeader}>Recent Sessions</div>
      {workouts.map(w => (
        <Link
          key={w.id}
          to={`/session/${w.id}`}
          className={`${styles.item} ${params.id === String(w.id) ? styles.itemActive : ''}`}
        >
          <div className={styles.itemTop}>
            <span className={styles.itemDate}>{formatRelativeDate(w.date)}</span>
            {w.inferred_tag && (
              <span className={`${styles.itemTag} ${TAG_CLASS[w.inferred_tag] || ''}`}>
                {w.inferred_tag}
              </span>
            )}
          </div>
          <div className={styles.itemTitle}>{workoutTitle(w)}</div>
          <div className={styles.itemMetrics}>
            <span className={styles.itemPace}>{formatPace(w.pace_ms)}</span>
            <span className={styles.itemDetail}>
              {formatDistance(w.distance)} · {formatTime(w.time_ms)}
              {w.stroke_rate ? ` · ${w.stroke_rate}spm` : ''}
            </span>
          </div>
          {w.pace_profile?.length >= 2 && (
            <div className={styles.sparklineRow}>
              <Sparkline
                data={w.pace_profile}
                color={w.inferred_tag === 'interval' ? 'var(--accent-2)' : 'var(--accent)'}
                width={96}
                height={20}
              />
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}
