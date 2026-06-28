import styles from './Stats.module.css';

export default function MetricsBar({ metrics }) {
  if (!metrics) return null;

  return (
    <div className={styles.metricsBar}>
      {metrics.fade_index != null && (
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Fade Index</span>
          <span className={styles.metricValue}>{metrics.fade_index.toFixed(1)}%</span>
        </div>
      )}
      {metrics.consistency != null && (
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Consistency</span>
          <span className={styles.metricValue}>{metrics.consistency.toFixed(0)}</span>
        </div>
      )}
      {metrics.effort_score != null && (
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Effort</span>
          <span className={styles.metricValue}>{metrics.effort_score.toFixed(0)}</span>
        </div>
      )}
      {metrics.drag_delta != null && (
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Drag Δ</span>
          <span className={styles.metricValue}>{metrics.drag_delta > 0 ? '+' : ''}{metrics.drag_delta.toFixed(0)}</span>
        </div>
      )}
    </div>
  );
}
