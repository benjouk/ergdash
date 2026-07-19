import styles from './PageHeader.module.css';

// Shared header for every top-level page so the title/subtitle treatment
// stays consistent. `actions` renders inline to the right of the title
// (e.g. the Workouts export buttons or the Plan "Today" button).
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h2 className={styles.title}>{title}</h2>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
