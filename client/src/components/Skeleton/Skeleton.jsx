import styles from './Skeleton.module.css';

function Block({ className = '' }) {
  return <span className={`${styles.block} ${className}`} aria-hidden="true" />;
}

export function ChartSkeleton() {
  return (
    <div className={styles.chartCard} aria-busy="true" aria-label="Loading chart">
      <div className={styles.chartHeader}>
        <Block className={styles.chartTitle} />
        <Block className={styles.chartValue} />
      </div>
      <Block className={styles.chartBody} />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <tr className={styles.rowSkeleton} aria-busy="true">
      <td colSpan={11}>
        <Block className={styles.rowBar} />
      </td>
    </tr>
  );
}

export function FeedItemSkeleton() {
  return (
    <div className={styles.feedItem} aria-busy="true" aria-label="Loading feed item">
      <div className={styles.feedTop}>
        <Block className={styles.feedDate} />
        <Block className={styles.feedTag} />
      </div>
      <Block className={styles.feedTitle} />
      <div className={styles.feedMetrics}>
        <Block className={styles.feedPace} />
        <Block className={styles.feedDetail} />
      </div>
    </div>
  );
}
