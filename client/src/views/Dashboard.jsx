import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useTimeRange } from '../context/TimeRangeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { distanceLabel } from '../components/PBBadge.jsx';
import StatsRow from '../components/Stats/StatsRow.jsx';
import VolumeSummaryCard from '../components/Stats/VolumeSummaryCard.jsx';
import SplitDonut from '../components/Stats/SplitDonut.jsx';
import PBStrip from '../components/Stats/PBStrip.jsx';
import CalendarHeatmap from '../components/Charts/CalendarHeatmap.jsx';
import FeedPanel from '../components/Feed/FeedPanel.jsx';
import PageHeader from '../components/PageHeader/PageHeader.jsx';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [goals, setGoals] = useState(null);
  const [pbEvents, setPbEvents] = useState([]);
  const [pbBannerHidden, setPbBannerHidden] = useState(false);
  const { from, to } = useTimeRange();
  const toast = useToast();

  useEffect(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    api.getSummary(params).then(setSummary).catch(() => {});
  }, [from, to]);

  useEffect(() => {
    api.getGoals().then(d => setGoals(d.goals || [])).catch(() => setGoals([]));
  }, []);

  useEffect(() => {
    let mounted = true;

    api.getSettings()
      .then(settings => {
        const params = {};
        if (settings.pb_last_seen_at) params.since = settings.pb_last_seen_at;
        return api.getPbHistory(params);
      })
      .then(data => {
        if (!mounted) return;
        setPbEvents(data.pb_history || []);
        setPbBannerHidden(false);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const dismissPbBanner = async () => {
    const seenAt = new Date().toISOString();
    setPbBannerHidden(true);

    try {
      await api.updateSettings({ pb_last_seen_at: seenAt });
      setPbEvents([]);
    } catch (err) {
      setPbBannerHidden(false);
      toast.error(err.message || 'Could not save PB notification state');
    }
  };

  return (
    <div className={styles.dashboard}>
      <PageHeader
        title="Dashboard"
        subtitle="Your recent training at a glance."
      />

      {pbEvents.length > 0 && !pbBannerHidden && (
        <section className={styles.pbBanner} aria-label="New personal best">
          <div>
            <span className={styles.pbBannerKicker}>Personal best</span>
            <p className={styles.pbBannerText}>
              {formatPbEvent(pbEvents[pbEvents.length - 1])}
              {pbEvents.length > 1 && (
                <span className={styles.pbBannerMore}> +{pbEvents.length - 1} more</span>
              )}
            </p>
          </div>
          <button type="button" className={styles.pbBannerButton} onClick={dismissPbBanner}>
            Dismiss
          </button>
        </section>
      )}

      <StatsRow summary={summary} goals={goals} />

      <div className={styles.chartsGrid}>
        <VolumeSummaryCard summary={summary} goals={goals} />
        <SplitDonut summary={summary} />
      </div>

      <section className={styles.mobileFeed} aria-label="Recent Sessions">
        <h3 className={styles.sectionHeader}>Recent Sessions</h3>
        <FeedPanel layout="row" />
      </section>

      <div>
        <h3 className={styles.sectionHeader}>Personal Bests</h3>
        <PBStrip />
      </div>

      <CalendarHeatmap />
    </div>
  );
}

function formatPbEvent(event) {
  const tagSuffix = event.tag === 'interval' ? ' (interval)' : '';
  return `New ${distanceLabel(event.distance)}${tagSuffix} PB - ${formatTimeTenths(event.time_ms)}`;
}

function formatTimeTenths(timeMs) {
  if (!timeMs || timeMs <= 0) return '--';
  const totalTenths = Math.round(timeMs / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
