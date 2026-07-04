import { useCallback, useEffect, useState } from 'react';

export function useChartData(fetcher, deps = []) {
  // undefined (not null) so callers' destructuring defaults (`data = []`) apply
  // on the initial render and after errors.
  const [data, setData] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    let mounted = true;

    setLoading(true);
    setError(null);

    Promise.resolve()
      .then(fetcher)
      .then(result => {
        if (!mounted) return;
        setData(result);
        setError(null);
      })
      .catch(err => {
        if (!mounted) return;
        setData(undefined);
        setError(err instanceof Error ? err : new Error('Could not load chart'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [...deps, attempt]);

  return { data, loading, error, retry };
}
