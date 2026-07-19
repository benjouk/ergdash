import FitnessChart from '../components/Charts/FitnessChart.jsx';
import PaceChart from '../components/Charts/PaceChart.jsx';
import VolumeChart from '../components/Charts/VolumeChart.jsx';
import ZoneStackChart from '../components/Charts/ZoneStackChart.jsx';
import PlanAdherenceChart from '../components/Charts/PlanAdherenceChart.jsx';
import Eyebrow from '../components/Eyebrow/Eyebrow.jsx';
import styles from './Progress.module.css';

export default function ProgressTraining() {
  return (
    <div className={styles.detailSections}>
      <section className={styles.detailSection} aria-labelledby="load-heading">
        <SectionHeading id="load-heading" eyebrow="Load & readiness" title="How much work is landing?" text="Fitness, fatigue, and form use the range selected in the top bar." />
        <FitnessChart />
      </section>

      <section className={styles.detailSection} aria-labelledby="consistency-heading">
        <SectionHeading id="consistency-heading" eyebrow="Consistency & balance" title="Is the work repeatable?" text="Steady pace stays like-for-like; volume and zones show how the load was built." />
        <div className={styles.detailGrid}>
          <PaceChart />
          <VolumeChart />
          <ZoneStackChart />
          <PlanAdherenceChart />
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ id, eyebrow, title, text }) {
  return (
    <div className={styles.sectionHeading}>
      <div><Eyebrow>{eyebrow}</Eyebrow><h3 id={id}>{title}</h3></div>
      <span>{text}</span>
    </div>
  );
}
