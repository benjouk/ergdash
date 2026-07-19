import { lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChartSkeleton } from '../components/Skeleton/Skeleton.jsx';
import { normalizeProgressView, PROGRESS_VIEWS } from './progressModel.js';
import styles from './Progress.module.css';

const PANELS = {
  overview: lazy(() => import('./ProgressOverview.jsx')),
  training: lazy(() => import('./ProgressTraining.jsx')),
  performance: lazy(() => import('./ProgressPerformance.jsx')),
  technique: lazy(() => import('./ProgressTechnique.jsx')),
};

const VIEW_META = {
  overview: { label: 'Overview', description: 'A clear read on whether your training is working.' },
  training: { label: 'Training', description: 'Load, consistency, steady pace, and training balance.' },
  performance: { label: 'Performance', description: 'Targets, predictions, personal bests, and race readiness.' },
  technique: { label: 'Technique', description: 'Like-for-like steady-session trends, one signal at a time.' },
};

export default function Progress() {
  const [searchParams] = useSearchParams();
  const activeView = normalizeProgressView(searchParams.get('view'));
  const Panel = PANELS[activeView];

  return (
    <div className={styles.progress}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Progress</h2>
          <p className={styles.subtitle}>{VIEW_META[activeView].description}</p>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Progress views">
        {PROGRESS_VIEWS.map(view => (
          <Link
            key={view}
            to={view === 'overview' ? '/progress' : `/progress?view=${view}`}
            className={`${styles.tab} ${activeView === view ? styles.tabActive : ''}`}
            aria-current={activeView === view ? 'page' : undefined}
          >
            {VIEW_META[view].label}
          </Link>
        ))}
      </nav>

      <Suspense fallback={<div className={styles.panelLoading}><ChartSkeleton /></div>}>
        <Panel />
      </Suspense>
    </div>
  );
}
