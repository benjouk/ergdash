import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { useUnits } from '../context/UnitsContext.jsx';
import { useSync } from '../context/SyncContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { units, setUnits } = useUnits();
  const { syncStatus, triggerSync } = useSync();
  const { user, logout } = useAuth();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch('/health').then(r => r.json()).then(setHealth).catch(() => {});
  }, []);

  const section = { marginBottom: 'var(--space-8)' };
  const sectionTitle = {
    fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700,
    letterSpacing: '-0.01em', color: 'var(--ink)', marginBottom: 'var(--space-4)',
  };
  const row = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: 'var(--space-3) 0', borderBottom: '1px solid var(--rule)',
  };
  const label = { fontSize: '0.85rem', color: 'var(--ink)' };
  const subtext = { fontSize: '0.75rem', color: 'var(--ink-3)', marginTop: 2 };

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{
        fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700,
        letterSpacing: '-0.02em', color: 'var(--ink)', marginBottom: 'var(--space-6)',
      }}>Settings</h2>

      <div style={section}>
        <h3 style={sectionTitle}>Appearance</h3>
        <div style={row}>
          <div>
            <div style={label}>Theme</div>
            <div style={subtext}>Controls light and dark mode</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {['system', 'light', 'dark'].map(t => (
              <button key={t} onClick={() => setTheme(t)} style={{
                padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem', fontWeight: 500, textTransform: 'capitalize',
                background: theme === t ? 'var(--accent)' : 'var(--surface)',
                color: theme === t ? '#fff' : 'var(--ink-2)',
                border: `1px solid ${theme === t ? 'var(--accent)' : 'var(--rule)'}`,
              }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={row}>
          <div>
            <div style={label}>Units</div>
            <div style={subtext}>Display format for pace values</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {[['pace', '/500m'], ['watts', 'Watts'], ['calhr', 'Cal/hr']].map(([val, lbl]) => (
              <button key={val} onClick={() => setUnits(val)} style={{
                padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem', fontWeight: 500,
                background: units === val ? 'var(--accent)' : 'var(--surface)',
                color: units === val ? '#fff' : 'var(--ink-2)',
                border: `1px solid ${units === val ? 'var(--accent)' : 'var(--rule)'}`,
              }}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={section}>
        <h3 style={sectionTitle}>Concept2 Connection</h3>
        <div style={row}>
          <div>
            <div style={label}>Status</div>
            <div style={subtext}>
              {user ? `Connected as ${user.first_name} ${user.last_name}` : 'Not connected'}
            </div>
          </div>
          {user ? (
            <button onClick={logout} style={{ ...btnStyle, color: 'var(--hot)', borderColor: 'var(--hot)' }}>Disconnect</button>
          ) : (
            <a href="/auth/login" style={{ ...btnStyle, color: 'var(--accent)', borderColor: 'var(--accent)', textDecoration: 'none' }}>Connect</a>
          )}
        </div>
      </div>

      <div style={section}>
        <h3 style={sectionTitle}>Sync</h3>
        <div style={row}>
          <div>
            <div style={label}>Status</div>
            <div style={subtext}>
              {syncStatus?.status === 'syncing' ? 'Syncing...' : `Last sync: ${syncStatus?.last_completed || 'Never'}`}
            </div>
          </div>
          <button onClick={triggerSync} style={btnStyle}>Sync Now</button>
        </div>
        <div style={row}>
          <div>
            <div style={label}>Stroke Data</div>
            <div style={subtext}>Enrichment progress</div>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--ink-2)' }}>
            {syncStatus?.enrichment_progress || '—'}
          </span>
        </div>
      </div>

      <div style={section}>
        <h3 style={sectionTitle}>Data</h3>
        <div style={row}>
          <div>
            <div style={label}>Database</div>
            <div style={subtext}>
              {health ? `${(health.database.size_bytes / 1024 / 1024).toFixed(1)} MB · ${health.database.workout_count} workouts` : '—'}
            </div>
          </div>
        </div>
        <div style={row}>
          <div>
            <div style={label}>Version</div>
            <div style={subtext}>{health?.version || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--rule)', background: 'var(--surface)', color: 'var(--ink-2)',
  fontSize: '0.8rem', cursor: 'pointer',
};
