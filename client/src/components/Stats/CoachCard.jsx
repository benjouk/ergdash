import { api } from '../../api.js';
import { useChartData } from '../Charts/useChartData.js';
import styles from './CoachCard.module.css';

// A weekly headline status, derived purely from the insight kinds already on
// screen — no new data. Amber = easing/fatigued, olive = building, grey = steady.
const STATUS = {
  easing: { label: 'Easing off', note: 'Volume down, form fresh — a good test window.', tone: 'warn' },
  building: { label: 'Building', note: 'Volume and fitness are trending up.', tone: 'pos' },
  fatigued: { label: 'Fatigued', note: 'Fatigue is elevated — favour easy sessions.', tone: 'warn' },
  steady: { label: 'Steady', note: 'Training is landing well this week.', tone: 'neu' },
};

function deriveStatus(insights) {
  const byId = Object.fromEntries(insights.map(i => [i.id, i.kind]));
  if (byId.form === 'watch') return STATUS.fatigued;
  if (byId.volume === 'positive' || byId.fitness === 'positive') return STATUS.building;
  if (byId.volume === 'watch' || byId.fitness === 'watch') return STATUS.easing;
  return STATUS.steady;
}

// A plain-language "This week" summary that turns the app's metrics into a few
// actionable lines. Severity is carried by a coloured dot per line; a single
// headline status badge sits alongside so the week reads at a glance.
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

  const status = !loading && insights.length > 0 ? deriveStatus(insights) : null;

  return (
    <section className={styles.card} aria-label="This week">
      <div className={styles.aside}>
        <span className={styles.kicker}>This week</span>
        {status && (
          <>
            <span className={`${styles.badge} ${styles[`badge_${status.tone}`]}`}>
              <span className={styles.badgeDot} aria-hidden="true" />
              {status.label}
            </span>
            <span className={styles.asideNote}>{status.note}</span>
          </>
        )}
      </div>

      {loading ? (
        <ul className={styles.list}>
          <li className={`${styles.item} ${styles.skeleton}`} />
          <li className={`${styles.item} ${styles.skeleton}`} />
          <li className={`${styles.item} ${styles.skeleton}`} />
          <li className={`${styles.item} ${styles.skeleton}`} />
        </ul>
      ) : (
        <ul className={styles.list}>
          {insights.map(item => (
            <li key={item.id} className={`${styles.item} ${styles[item.kind] || ''}`}>
              <span className={styles.dot} aria-hidden="true" />
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
