import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Ticker from './components/Ticker/Ticker.jsx';
import BottomNav from './components/BottomNav/BottomNav.jsx';
import FeedPanel from './components/Feed/FeedPanel.jsx';
import Dashboard from './views/Dashboard.jsx';
import Session from './views/Session.jsx';
import Progress from './views/Progress.jsx';
import Workouts from './views/Workouts.jsx';
import Settings from './views/Settings.jsx';
import Connect from './views/Connect.jsx';
import styles from './App.module.css';

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingMark}>
          ROW<span className={styles.loadingSlash}>//</span>DASH
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
            <Route path="/" element={<Dashboard />} />
            <Route path="/session/:id" element={<Session />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/workouts" element={<Workouts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
