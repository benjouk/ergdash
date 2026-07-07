import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { usePrefs } from './context/PrefsContext.jsx';
import Ticker from './components/Ticker/Ticker.jsx';
import BottomNav from './components/BottomNav/BottomNav.jsx';
import FeedPanel from './components/Feed/FeedPanel.jsx';
import Dashboard from './views/Dashboard.jsx';
import Session from './views/Session.jsx';
import Progress from './views/Progress.jsx';
import Workouts from './views/Workouts.jsx';
import Tools from './views/Tools.jsx';
import Settings from './views/Settings.jsx';
import Connect from './views/Connect.jsx';
import styles from './App.module.css';

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/progress': 'Progress',
  '/workouts': 'Workouts',
  '/tools': 'Tools',
  '/settings': 'Settings',
};

function usePageTitle(isAuthenticated) {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = pathname.startsWith('/session/') ? 'Session' : PAGE_TITLES[pathname];
    document.title = isAuthenticated && page ? `${page} · ErgDash` : 'ErgDash';
  }, [pathname, isAuthenticated]);
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const { defaultLanding } = usePrefs();
  usePageTitle(isAuthenticated);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingMark}>
          Erg<span className={styles.loadingAccent}>Dash</span>
        </span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Connect />;
  }

  return (
    <div className={styles.appShell}>
      <Ticker />
      <div className={styles.layout}>
        <aside aria-label="Recent Sessions" className={styles.feed}>
          <FeedPanel />
        </aside>
        <main className={styles.main}>
          <Routes>
            <Route path="/" element={defaultLanding && defaultLanding !== '/' ? <Navigate to={defaultLanding} replace /> : <Dashboard />} />
            <Route path="/session/:id" element={<Session />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/workouts" element={<Workouts />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
