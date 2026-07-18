import { useState, useEffect } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { Pin } from 'lucide-react';
import { api } from '../../api.js';
import { useUnits } from '../../context/UnitsContext.jsx';
import { useTimeRange } from '../../context/TimeRangeContext.jsx';
import { usePrefs } from '../../context/PrefsContext.jsx';
import { FeedItemSkeleton } from '../Skeleton/Skeleton.jsx';
import PBBadges from '../PBBadge.jsx';
import Sparkline from './Sparkline.jsx';
import { structureLabel, structureTooltip } from '../../utils/workoutStructure.js';
import { groupByDay } from '../../utils/dateGroups.js';
import styles from './Feed.module.css';

function formatDateShort(dateStr, dateFormat) {
  const options = dateFormat === 'month-day'
    ? { month: 'short', day: 'numeric' }
    : { day: 'numeric', month: 'short' };
  return new Date(dateStr).toLocaleDateString('en-GB', options);
}

function formatRelativeDate(dateStr, dateFormat) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffHours = diffMs / 3600000;
  const diffDays = diffMs / 86400000;

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffDays < 2) return 'Yesterday';
  if (diffDays < 7) return `${Math.floor(diffDays)}d ago`;
  return formatDateShort(dateStr, dateFormat);
}

const TAG_CLASS = {
  endurance: styles.tagSteady,
  interval: styles.tagInterval,
};

export default function FeedPanel({ layout = 'column' }) {
  const [workouts, setWorkouts] = useState([]);
  const [pinnedWorkouts, setPinnedWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const activeId = useMatch('/session/:id')?.params?.id;
  const { units, formatPace, formatDistance, formatTime } = useUnits();
  const { from, to } = useTimeRange();
  const { feedLimit, dateFormat } = usePrefs();

  const isRow = layout === 'row';

  useEffect(() => {
    let mounted = true;
    const p = { limit: isRow ? 12 : feedLimit, sort: 'date_desc' };
    if (from) p.from = from;
    if (to) p.to = to;
    const pinnedParams = { pinned: 1, limit: 10, sort: 'date_desc' };
    setLoading(true);
    setError('');
    Promise.all([
      api.getWorkouts(p),
      api.getWorkouts(pinnedParams),
    ])
      .then(([recentData, pinnedData]) => {
        if (!mounted) return;
        setWorkouts(recentData.data || []);
        setPinnedWorkouts(pinnedData.data || []);
      })
      .catch(err => {
        if (!mounted) return;
        setWorkouts([]);
        setPinnedWorkouts([]);
        setError(err.message || 'Could not load recent sessions');
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
        setLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, [from, to, isRow, activeId, feedLimit]);

  return (
    <div className={styles.feed}>
      {pinnedWorkouts.length > 0 && (
        <>
          <div className={styles.feedHeader}>Pinned</div>
          <div className={`${styles.itemList} ${isRow ? styles.itemListRow : ''}`}>
            {pinnedWorkouts.map(w => (
              <FeedItem
                key={`pinned-${w.id}`}
                workout={w}
                active={activeId === String(w.id)}
                pinned
                units={units}
                formatPace={formatPace}
                formatDistance={formatDistance}
                formatTime={formatTime}
                dateFormat={dateFormat}
              />
            ))}
          </div>
        </>
      )}
      {/* In row layout the parent section renders its own "Recent Sessions"
          heading, so only repeat it when a Pinned group needs separating. */}
      {(!isRow || pinnedWorkouts.length > 0) && (
        <div className={styles.feedHeader}>Recent Sessions</div>
      )}
      {loading && !loaded ? (
        <div className={`${styles.itemList} ${isRow ? styles.itemListRow : ''}`}>
          {Array.from({ length: isRow ? 4 : 6 }).map((_, index) => (
            <FeedItemSkeleton key={`feed-skeleton-${index}`} />
          ))}
        </div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : workouts.length === 0 ? (
        <div className={styles.empty}>No workouts yet</div>
      ) : isRow ? (
        <div className={`${styles.itemList} ${styles.itemListRow}`}>
          {workouts.map(w => (
            <FeedItem
              key={w.id}
              workout={w}
              active={activeId === String(w.id)}
              units={units}
              formatPace={formatPace}
              formatDistance={formatDistance}
              formatTime={formatTime}
              dateFormat={dateFormat}
            />
          ))}
        </div>
      ) : (
        groupByDay(workouts, dateFormat).map(group => (
          <div key={group.key}>
            <div className={styles.dayHeader}>{group.label}</div>
            <div className={styles.itemList}>
              {group.items.map(w => (
                <FeedItem
                  key={w.id}
                  workout={w}
                  active={activeId === String(w.id)}
                  showDate={false}
                  units={units}
                  formatPace={formatPace}
                  formatDistance={formatDistance}
                  formatTime={formatTime}
                  dateFormat={dateFormat}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function FeedItem({ workout, active, pinned = false, showDate = true, units, formatPace, formatDistance, formatTime, dateFormat }) {
  const hasBadges = workout.pb_distances?.length > 0 || workout.inferred_tag;
  return (
    <Link
      to={`/session/${workout.id}`}
      className={`${styles.item} ${active ? styles.itemActive : ''}`}
    >
      {(showDate || hasBadges) && (
        <div className={styles.itemTop}>
          {showDate && (
            <span className={styles.itemDate}>
              {pinned && <Pin size={12} className={styles.pinnedGlyph} fill="currentColor" />}
              {formatRelativeDate(workout.date, dateFormat)}
            </span>
          )}
          <span className={styles.itemBadges}>
            <PBBadges distances={workout.pb_distances} compact />
            {workout.inferred_tag && (
              <span
                className={`${styles.itemTag} ${TAG_CLASS[workout.inferred_tag] || ''}`}
                title={structureTooltip(workout.inferred_tag)}
              >
                {structureLabel(workout.inferred_tag)}
              </span>
            )}
          </span>
        </div>
      )}
      <div className={styles.itemMetrics}>
        <span className={styles.itemPace}>{formatPace(workout.pace_ms)}</span>
        {units === 'pace' && <span className={styles.paceUnit}>/500 m</span>}
      </div>
      <div className={styles.itemDetail}>
        <span className={styles.itemDistance}>{formatDistance(workout.distance)}</span> · {formatTime(workout.time_ms)}
        {workout.stroke_rate ? ` · ${workout.stroke_rate}spm` : ''}
      </div>
      {workout.pace_profile?.length >= 2 && (
        <div className={styles.sparklineRow}>
          <Sparkline
            data={workout.pace_profile}
            color={workout.inferred_tag === 'interval' ? 'var(--accent-2)' : 'var(--accent)'}
            width={96}
            height={20}
          />
        </div>
      )}
    </Link>
  );
}
