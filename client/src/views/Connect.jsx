import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import styles from './Connect.module.css';

const FEATURES = [
  { title: 'Track', desc: 'Every session, pace, and stroke', accent: '#C3D500' },
  { title: 'Analyse', desc: 'Trends, comparisons, personal bests', accent: '#38B6FF' },
  { title: 'Improve', desc: 'Coaching insights and fitness tracking', accent: '#FFB000' },
];

export default function Connect() {
  const [searchParams] = useSearchParams();
  const { checkAuth } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);

  const connected = searchParams.get('connected') === 'true';
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    if (connected) {
      setSyncing(true);
      const interval = setInterval(async () => {
        try {
          const status = await api.getSyncStatus();
          setSyncProgress(status);
          if (status.status === 'idle' && status.total_workouts > 0) {
            clearInterval(interval);
            setSyncing(false);
            checkAuth();
          }
        } catch {}
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [connected, checkAuth]);

  return (
    <div className={styles.connect}>
      <div className={styles.inner}>
        <div className={styles.wordmark}>
          Erg<span className={styles.wordmarkAccent}>Dash</span>
        </div>

        <p className={styles.tagline}>
          Your personal rowing dashboard. Connect your Concept2 Logbook to track progress,
          analyse sessions, and monitor training trends.
        </p>

        {syncing ? (
          <div className={styles.syncing}>
            <div className={styles.syncingLabel}>Importing your workouts...</div>
            <div className={styles.progressTrack}>
              <div
                className={`${styles.progressFill} ${syncProgress?.status === 'syncing' ? styles.progressPulse : ''}`}
                style={{ width: syncProgress?.total_workouts ? '100%' : '30%' }}
              />
            </div>
            {syncProgress && (
              <div className={styles.syncCount}>
                {syncProgress.total_workouts} workouts synced
              </div>
            )}
          </div>
        ) : (
          <div className={styles.actions}>
            <a href="/auth/login" className={styles.cta}>
              Connect with Concept2
            </a>

            {isDev && (
              <a href="/auth/mock-login" className={styles.devLink}>
                Dev Mode: Skip Auth
              </a>
            )}
          </div>
        )}

        <div className={styles.features}>
          {FEATURES.map(f => (
            <div key={f.title} className={styles.feature} style={{ '--feature-accent': f.accent }}>
              <div className={styles.featureTitle}>{f.title}</div>
              <div className={styles.featureDesc}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
