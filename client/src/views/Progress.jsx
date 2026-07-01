import FitnessChart from '../components/Charts/FitnessChart.jsx';
import PaceChart from '../components/Charts/PaceChart.jsx';
import VolumeChart from '../components/Charts/VolumeChart.jsx';
import styles from './Progress.module.css';

export default function Progress() {
  return (
    <div className={styles.progress}>
      <h2 className={styles.title}>Progress</h2>

      <FitnessChart />

      <div className={styles.secondaryGrid}>
        <PaceChart />
        <VolumeChart />
      </div>
    </div>
  );
}
