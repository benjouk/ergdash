import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Ticker from './components/Ticker/Ticker.jsx';
import FeedPanel from './components/Feed/FeedPanel.jsx';
import Dashboard from './views/Dashboard.jsx';
import Session from './views/Session.jsx';
import Progress from './views/Progress.jsx';
import Workouts from './views/Workouts.jsx';
import Settings from './views/Settings.jsx';
import Connect from './views/Connect.jsx';

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', color: 'var(--ink-3)', fontFamily: 'var(--font-display)',
      }}>
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Connect />;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Ticker />
      <div style={{
        display: 'flex', flex: 1, marginTop: 'var(--ticker-height)',
        width: '100%',
      }}>
        <aside aria-label="Recent Sessions" style={{
          width: 'var(--feed-width)', flexShrink: 0, borderRight: '1px solid var(--rule)',
          overflowY: 'auto', height: 'calc(100vh - var(--ticker-height))',
          position: 'sticky', top: 'var(--ticker-height)',
        }}>
          <FeedPanel />
        </aside>
        <main style={{
          flex: 1, minWidth: 0, padding: 'var(--space-6)',
          maxWidth: 'calc(1400px - var(--feed-width))',
        }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/session/:id" element={<Session />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/workouts" element={<Workouts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
