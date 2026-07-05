import { Sparkles, TrendingUp, TriangleAlert, Minus } from 'lucide-react';
import { api } from '../../api.js';
import { useChartData } from '../Charts/useChartData.js';
import styles from './CoachCard.module.css';

const KIND_ICON = {
  positive: TrendingUp,
  watch: TriangleAlert,
  neutral: Minus,
};

// A plain-language "This week" summary that turns the app's metrics into a few
// actionable lines. Bright accent is reserved for genuinely positive signals so
// the eye lands on progress, not on every value.
export default function CoachCard() {
  const { data, loading, error } = useChartData(
    () => api.getWeeklyInsight().then(d => d.insights || []),
    [],
  );

  // Stay quiet rather than showing an error card — this sits at the very top of
  // the dashboard and shouldn't shout if the endpoint is unavailable.
  if (error) return null;

  const insights = data || [];
  if (!loading && insights.length === 0) return null;

  return (
    <section className={styles.card} aria-label="This week">
      <div className={styles.header}>
        <Sparkles size={16} className={styles.headerIcon} aria-hidden="true" />
        <span className={styles.kicker}>This week</span>
      </div>

      {loading ? (
        <ul className={styles.list}>
          <li className={`${styles.item} ${styles.skeleton}`} />
          <li className={`${styles.item} ${styles.skeleton}`} />
          <li className={`${styles.item} ${styles.skeleton}`} />
        </ul>
      ) : (
        <ul className={styles.list}>
          {insights.map(item => {
            const Icon = KIND_ICON[item.kind] || Minus;
            return (
              <li key={item.id} className={`${styles.item} ${styles[item.kind] || ''}`}>
                <Icon size={15} className={styles.itemIcon} aria-hidden="true" />
                <span>{item.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
