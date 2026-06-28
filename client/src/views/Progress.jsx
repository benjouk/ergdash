import FitnessChart from '../components/Charts/FitnessChart.jsx';
import PaceChart from '../components/Charts/PaceChart.jsx';
import VolumeChart from '../components/Charts/VolumeChart.jsx';

export default function Progress() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <h2 style={{
        fontFamily: 'var(--font-display)',
        fontSize: '1.3rem',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        color: 'var(--ink)',
      }}>Progress</h2>

      <FitnessChart />
      <PaceChart />
      <VolumeChart />
    </div>
  );
}
