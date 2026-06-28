import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
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
  endurance: styles.tagEndurance,
  interval: styles.tagInterval,
  test: styles.tagTest,
  warmup: styles.tagWarmup,
};

function workoutTitle(w) {
  const dist = w.distance >= 1000 ? `${(w.distance / 1000).toFixed(w.distance % 1000 === 0 ? 0 : 1)}k` : `${w.distance}m`;
  if (w.inferred_tag === 'interval') return `${dist} intervals`;
  if (w.inferred_tag === 'test') return `${dist} test`;
  if (w.inferred_tag === 'warmup') return `${dist} warmup`;
  return `${dist} steady`;
}

export default function FeedPanel() {
  const [workouts, setWorkouts] = useState([]);
  const navigate = useNavigate();
  const params = useParams();
  const { formatPace, formatDistance, formatTime } = useUnits();

  useEffect(() => {
    api.getWorkouts({ limit: 50, sort: 'date_desc' })
      .then(data => setWorkouts(data.data || []))
      .catch(() => {});
  }, []);

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
        <div
          key={w.id}
          className={`${styles.item} ${params.id === String(w.id) ? styles.itemActive : ''}`}
          onClick={() => navigate(`/session/${w.id}`)}
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
        </div>
      ))}
    </div>
  );
}
