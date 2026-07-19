import { Component } from 'react';
import styles from './ErrorBoundary.module.css';

// A content-hashed chunk that no longer exists on the server (a tab left open
// across a redeploy) fails its dynamic import. That is fixed by reloading,
// not a bug worth alarming anyone about.
export function isStaleChunkError(error) {
  return /dynamically imported module|Loading chunk|Importing a module script failed/i.test(
    error?.message || ''
  );
}

export function ErrorFallback({ error }) {
  const stale = isStaleChunkError(error);
  return (
    <div className={styles.wrap} role="alert">
      <h2 className={styles.title}>{stale ? 'ErgDash was updated' : 'Something went wrong'}</h2>
      <p className={styles.detail}>
        {stale
          ? 'A newer version is available - reload to pick it up.'
          : error?.message || 'An unexpected error occurred.'}
      </p>
      <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

// Catches render errors (and failed lazy-route imports) so one broken view
// degrades to a message instead of white-screening the whole app. resetKey
// clears the error on navigation so the rest of the app stays usable.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} />;
    return this.props.children;
  }
}
