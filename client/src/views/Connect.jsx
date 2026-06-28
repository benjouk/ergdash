import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

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
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 'var(--space-6)',
    }}>
      <div style={{
        textAlign: 'center', maxWidth: 420, display: 'flex', flexDirection: 'column',
        gap: 'var(--space-6)', alignItems: 'center',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2.5rem',
          letterSpacing: '-0.03em', color: 'var(--ink)',
        }}>
          ROW<span style={{ color: 'var(--accent)' }}>//</span>DASH
        </div>

        <p style={{ fontSize: '1rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Your personal rowing dashboard. Connect your Concept2 Logbook to track progress,
          analyse sessions, and monitor training trends.
        </p>

        {syncing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--ink-2)' }}>Importing your workouts...</div>
            <div style={{
              width: 200, height: 4, background: 'var(--rule)', borderRadius: 2, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', background: 'var(--accent)', borderRadius: 2,
                width: syncProgress?.total_workouts ? '100%' : '30%',
                transition: 'width 500ms ease',
                animation: syncProgress?.status === 'syncing' ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} />
            </div>
            {syncProgress && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink-3)' }}>
                {syncProgress.total_workouts} workouts synced
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center' }}>
            <a href="/auth/login" style={{
              display: 'inline-block', padding: 'var(--space-3) var(--space-6)',
              background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-md)',
              fontSize: '0.95rem', fontWeight: 600, textDecoration: 'none',
              transition: 'opacity 150ms',
            }}>
              Connect with Concept2
            </a>

            {isDev && (
              <a href="/auth/mock-login" style={{
                fontSize: '0.8rem', color: 'var(--ink-3)', textDecoration: 'underline',
              }}>
                Dev Mode: Skip Auth
              </a>
            )}
          </div>
        )}

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)',
          marginTop: 'var(--space-4)', width: '100%',
        }}>
          {[
            { title: 'Track', desc: 'Every session, pace, and stroke' },
            { title: 'Analyse', desc: 'Trends, comparisons, personal bests' },
            { title: 'Improve', desc: 'AI coaching insights and fitness tracking' },
          ].map(f => (
            <div key={f.title} style={{
              padding: 'var(--space-4)', background: 'var(--surface)',
              border: '1px solid var(--rule)', borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 'var(--space-1)' }}>{f.title}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-2)', lineHeight: 1.4 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
