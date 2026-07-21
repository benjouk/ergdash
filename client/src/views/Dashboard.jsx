import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useProfileQuery } from '../hooks/useProfileQuery.js';
import { useTimeRange } from '../context/TimeRangeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { distanceLabel } from '../components/PBBadge.jsx';
import StatsRow from '../components/Stats/StatsRow.jsx';
import VolumeSummaryCard from '../components/Stats/VolumeSummaryCard.jsx';
import SplitDonut from '../components/Stats/SplitDonut.jsx';
import PBStrip from '../components/Stats/PBStrip.jsx';
import CalendarHeatmap from '../components/Charts/CalendarHeatmap.jsx';
import ChartEmpty from '../components/Charts/ChartEmpty.jsx';
import FeedPanel from '../components/Feed/FeedPanel.jsx';
import PageHeader from '../components/PageHeader/PageHeader.jsx';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const [pbBannerHidden, setPbBannerHidden] = useState(false);
  const { from, to } = useTimeRange();
  const toast = useToast();

  const summaryParams = {};
  if (from) summaryParams.from = from;
  if (to) summaryParams.to = to;
  const summaryQuery = useProfileQuery(
    ['summary', summaryParams],
    () => api.getSummary(summaryParams)
  );
  const { data: summary = null, error: summaryError, refetch: refetchSummary } = summaryQuery;
  const goalsQuery = useProfileQuery(['goals'], api.getGoals);
  const { data: goalsData, error: goalsError, refetch: refetchGoals } = goalsQuery;
  const goals = goalsData ? goalsData.goals || [] : null;
  const settingsQuery = useProfileQuery(['settings'], api.getSettings);
  const { data: settings, error: settingsError, refetch: refetchSettings } = settingsQuery;
  const pbParams = {};
  if (settings?.pb_last_seen_at) pbParams.since = settings.pb_last_seen_at;
  const pbHistoryQuery = useProfileQuery(
    ['pb-history', pbParams],
    () => api.getPbHistory(pbParams),
    { enabled: settings !== undefined }
  );
  const { data: pbData, error: pbHistoryError, refetch: refetchPbHistory } = pbHistoryQuery;
  const pbEvents = pbData?.pb_history || [];

  useEffect(() => {
    setPbBannerHidden(false);
  }, [pbEvents]);

  const dismissPbBanner = async () => {
    const seenAt = new Date().toISOString();
    setPbBannerHidden(true);

    try {
      await api.updateSettings({ pb_last_seen_at: seenAt });
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

      {summaryError ? (
        <ChartEmpty
          title="Training Summary"
          message="Couldn't load your training summary."
          error
          onRetry={refetchSummary}
        />
      ) : (
        <>
          <StatsRow summary={summary} goals={goals} />
          <div className={styles.chartsGrid}>
            <VolumeSummaryCard summary={summary} goals={goals} />
            <SplitDonut summary={summary} />
          </div>
        </>
      )}

      {goalsError && (
        <DataNotice message="Goal progress is unavailable." onRetry={refetchGoals} />
      )}
      {settingsError && (
        <DataNotice message="Dashboard preferences are unavailable." onRetry={refetchSettings} />
      )}
      {pbHistoryError && (
        <DataNotice message="Personal-best notifications are unavailable." onRetry={refetchPbHistory} />
      )}

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

function DataNotice({ message, onRetry }) {
  return (
    <div className={styles.dataNotice} role="alert">
      <span>{message}</span>
      <button type="button" onClick={() => Promise.resolve(onRetry()).catch(() => {})}>Retry</button>
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
