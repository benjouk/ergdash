import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { usePrefs } from './context/PrefsContext.jsx';
import { useToast } from './context/ToastContext.jsx';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary.jsx';
import Ticker from './components/Ticker/Ticker.jsx';
import BottomNav from './components/BottomNav/BottomNav.jsx';
import FeedPanel from './components/Feed/FeedPanel.jsx';
import Connect from './views/Connect.jsx';
import styles from './App.module.css';

const Dashboard = lazy(() => import('./views/Dashboard.jsx'));
const Session = lazy(() => import('./views/Session.jsx'));
const Progress = lazy(() => import('./views/Progress.jsx'));
const Workouts = lazy(() => import('./views/Workouts.jsx'));
const Plan = lazy(() => import('./views/Plan.jsx'));
const Tools = lazy(() => import('./views/Tools.jsx'));
const Settings = lazy(() => import('./views/Settings.jsx'));

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/progress': 'Progress',
  '/workouts': 'Workouts',
  '/plan': 'Plan',
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
  const { isAuthenticated, isLoading, profiles } = useAuth();
  const { defaultLanding } = usePrefs();
  const toast = useToast();
  const { pathname } = useLocation();
  usePageTitle(isAuthenticated);

  // Offline visibility: with the service worker serving cached data, the app
  // keeps working when the server is unreachable - say so, or stale numbers
  // look current.
  useEffect(() => {
    const goneOffline = () => toast.error('Offline - showing your last synced data');
    const backOnline = () => toast.success('Back online');
    window.addEventListener('offline', goneOffline);
    window.addEventListener('online', backOnline);
    return () => {
      window.removeEventListener('offline', goneOffline);
      window.removeEventListener('online', backOnline);
    };
  }, [toast]);

  // The OAuth callback redirects to /?error=<code> when a connect/reconnect is
  // refused. Surface it once, then strip the param so a refresh doesn't repeat.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('error');
    if (!code) return;
    const messages = {
      logbook_in_use: 'That Concept2 account is already linked to another profile.',
      wrong_account: 'That is a different Concept2 account than this profile uses - reconnect the original account, or add a new profile.',
      profile_not_found: 'That profile no longer exists.',
      account_not_registered: 'That Concept2 account is not registered with this ErgDash instance.',
      setup_complete: 'This ErgDash instance has already been set up. Sign in with an existing profile.',
      session_required: 'Your ErgDash session expired. Sign in again before adding or reconnecting a profile.',
      auth_failed: 'Connecting to Concept2 failed. Please try again.',
    };
    toast.error(messages[code] || 'Something went wrong connecting to Concept2.');
    params.delete('error');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [toast]);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingMark}>
          Erg<span className={styles.loadingAccent}>Dash</span>
        </span>
      </div>
    );
  }

  // A valid session with no profiles (e.g. the last one was removed) has
  // nothing to render - send them to Connect to add one rather than a shell
  // of 409s.
  if (!isAuthenticated || (profiles && profiles.length === 0)) {
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
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<div className={styles.routeLoading}>Loading…</div>}>
              <Routes>
                <Route path="/" element={defaultLanding && defaultLanding !== '/' ? <Navigate to={defaultLanding} replace /> : <Dashboard />} />
                <Route path="/session/:id" element={<Session />} />
                <Route path="/progress" element={<Progress />} />
                <Route path="/workouts" element={<Workouts />} />
                <Route path="/plan" element={<Plan />} />
                <Route path="/tools" element={<Tools />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
