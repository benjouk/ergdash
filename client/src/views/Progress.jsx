import FitnessChart from '../components/Charts/FitnessChart.jsx';
import PaceChart from '../components/Charts/PaceChart.jsx';
import VolumeChart from '../components/Charts/VolumeChart.jsx';
import CumulativeMetersChart from '../components/Charts/CumulativeMetersChart.jsx';
import EfficiencyChart from '../components/Charts/EfficiencyChart.jsx';
import DpsTrendChart from '../components/Charts/DpsTrendChart.jsx';
import PowerCurveChart from '../components/Charts/PowerCurveChart.jsx';
import ZoneStackChart from '../components/Charts/ZoneStackChart.jsx';
import HrDriftChart from '../components/Charts/HrDriftChart.jsx';
import RateDisciplineCard from '../components/Charts/RateDisciplineCard.jsx';
import DragFactorChart from '../components/Charts/DragFactorChart.jsx';
import FadeFingerprint from '../components/Charts/FadeFingerprint.jsx';
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

      <div className={styles.secondaryGrid}>
        <PowerCurveChart />
        <ZoneStackChart />
      </div>

      <div className={styles.secondaryGrid}>
        <CumulativeMetersChart />
        <DragFactorChart />
      </div>

      <div className={styles.secondaryGrid}>
        <EfficiencyChart />
        <DpsTrendChart />
      </div>

      <div className={styles.secondaryGrid}>
        <HrDriftChart />
        <RateDisciplineCard />
      </div>

      <FadeFingerprint />
    </div>
  );
}
