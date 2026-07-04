import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { useUnits } from '../../context/UnitsContext.jsx';
import chartStyles from '../Charts/Charts.module.css';
import styles from './Stats.module.css';

export default function SplitDonut({ summary }) {
  const { formatDistance } = useUnits();
  if (!summary) return null;

  const steady = summary.split_steady_m || 0;
  const interval = summary.split_interval_m || 0;
  const total = steady + interval;
  if (total <= 0) return null;

  const data = [
    { name: 'Endurance', value: steady, color: 'var(--accent)' },
    { name: 'Interval', value: interval, color: 'var(--accent-2)' },
  ];

  return (
    <div className={chartStyles.chartCard}>
      <div className={chartStyles.chartHeader}>
        <div className={chartStyles.chartTitle}>Session Mix</div>
      </div>
      <div className={styles.donutRow}>
        <div className={styles.donutViewport}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius="68%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                stroke="none"
              >
                {data.map(entry => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className={styles.donutCenter}>
            <span className={styles.donutCenterValue}>{formatDistance(total)}</span>
            <span className={styles.donutCenterLabel}>total</span>
          </div>
        </div>
        <div className={styles.donutLegend}>
          {data.map(entry => (
            <div key={entry.name} className={styles.donutLegendRow}>
              <span className={styles.donutSwatch} style={{ background: entry.color }} />
              <span className={styles.donutLegendLabel}>{entry.name}</span>
              <span className={styles.donutLegendValue}>{Math.round((entry.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
