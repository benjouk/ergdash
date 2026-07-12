import styles from './Charts.module.css';

const DEFAULT_MESSAGE = 'Not enough data yet. Row a few more sessions.';

export default function ChartEmpty({
  title,
  message = DEFAULT_MESSAGE,
  error = false,
  onRetry,
}) {
  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>{title}</div>
      </div>
      <div className={styles.chartEmpty}>
        <p>{message}</p>
        {error && onRetry && (
          <button type="button" className={styles.chartRetryButton} onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
