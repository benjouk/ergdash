import StatsRow from '../components/Stats/StatsRow.jsx';
import VolumeChart from '../components/Charts/VolumeChart.jsx';
import PaceChart from '../components/Charts/PaceChart.jsx';
import PBStrip from '../components/Stats/PBStrip.jsx';
import FitnessChart from '../components/Charts/FitnessChart.jsx';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <StatsRow />

      <div className={styles.chartsGrid}>
        <VolumeChart />
        <PaceChart />
      </div>

      <div>
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.8rem',
          fontWeight: 600,
          color: 'var(--ink-2)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 'var(--space-3)',
        }}>Personal Bests</h3>
        <PBStrip />
      </div>

      <FitnessChart compact />
    </div>
  );
}
