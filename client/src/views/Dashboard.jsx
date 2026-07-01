import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useUnits } from '../context/UnitsContext.jsx';
import { useTimeRange } from '../context/TimeRangeContext.jsx';
import StatsRow from '../components/Stats/StatsRow.jsx';
import VolumeChart from '../components/Charts/VolumeChart.jsx';
import PaceChart from '../components/Charts/PaceChart.jsx';
import PBStrip from '../components/Stats/PBStrip.jsx';
import FitnessChart from '../components/Charts/FitnessChart.jsx';
import FeedPanel from '../components/Feed/FeedPanel.jsx';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const { formatDistanceFull } = useUnits();
  const { from, to, rangeKey, describeRange } = useTimeRange();

  useEffect(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    api.getSummary(params).then(setSummary).catch(() => {});
  }, [from, to]);

  const metersLabel = summary?.season_meters > 0 ? 'Season Metres' : 'Total Metres';
  const metersValue = summary
    ? (summary.season_meters > 0 ? summary.season_meters : summary.total_meters)
    : null;

  return (
    <div className={styles.dashboard}>
      {summary && (
        <section className={styles.hero} aria-label={metersLabel}>
          <span className={styles.heroKicker}>{metersLabel}</span>
          <span className={`heroNum ${styles.heroValue}`}>{formatDistanceFull(metersValue)}</span>
          <span className={styles.heroContext}>{describeRange(rangeKey)}</span>
        </section>
      )}

      <StatsRow summary={summary} showMeters={false} />

      <section className={styles.mobileFeed} aria-label="Recent Sessions">
        <h3 className={styles.sectionHeader}>Recent Sessions</h3>
        <FeedPanel layout="row" />
      </section>

      <div className={styles.chartsGrid}>
        <VolumeChart />
        <PaceChart />
      </div>

      <div>
        <h3 className={styles.sectionHeader}>Personal Bests</h3>
        <PBStrip />
      </div>

      <FitnessChart compact />
    </div>
  );
}
