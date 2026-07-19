import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { useChartData } from '../components/Charts/useChartData.js';
import { ChartSkeleton } from '../components/Skeleton/Skeleton.jsx';
import TargetsCard from '../components/Stats/TargetsCard.jsx';
import RacePlanCard from '../components/Stats/RacePlanCard.jsx';
import PredictedTimesCard from '../components/Stats/PredictedTimesCard.jsx';
import PowerCurveChart from '../components/Charts/PowerCurveChart.jsx';
import PbTimelineChart from '../components/Charts/PbTimelineChart.jsx';
import FadeFingerprint from '../components/Charts/FadeFingerprint.jsx';
import styles from './Progress.module.css';

export default function ProgressPerformance() {
  const { data: goals = [], loading } = useChartData(() => api.getGoals().then(result => result.goals || []), []);
  const performanceGoals = goals.filter(goal => goal.kind === 'performance' && goal.active);

  return (
    <div className={styles.detailSections}>
      <section className={styles.detailSection} aria-labelledby="targets-heading">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Targets & readiness</span><h3 id="targets-heading">What can you produce now?</h3></div>
          <span>Targets and predictions are current-state estimates, independent of the selected range.</span>
        </div>
        {loading ? (
          <ChartSkeleton />
        ) : performanceGoals.length === 0 ? (
          <div className={styles.inlineEmpty}>
            <div><h4>No performance target yet</h4><p>Set a target time or race date to turn these trends into a readiness verdict.</p></div>
            <Link to="/settings" className={styles.primaryAction}>Set a target <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
        ) : !loading ? (
          <div className={styles.targetStack}>
            <TargetsCard goals={goals} />
            <RacePlanCard goals={goals} />
          </div>
        ) : null}
      </section>

      <section className={styles.detailSection} aria-labelledby="benchmarks-heading">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Benchmarks</span><h3 id="benchmarks-heading">Speed across the range</h3></div>
          <span>Selected-period bests sit alongside current projections and PB history.</span>
        </div>
        <div className={styles.benchmarkColumns}>
          <div className={styles.benchmarkColumn}>
            <PredictedTimesCard />
            <PbTimelineChart />
          </div>
          <div className={styles.benchmarkColumn}>
            <PowerCurveChart />
            <FadeFingerprint />
          </div>
        </div>
      </section>
    </div>
  );
}
