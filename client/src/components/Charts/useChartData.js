import { useCallback, useEffect, useState } from 'react';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const handler = e => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

// Pick a "nice" round step (1/2/2.5/5/10 x a power of ten) closest to the
// given rough step, the same family of steps d3/Recharts use internally —
// generated explicitly here since relying on Recharts' own tickCount/domain
// heuristics produces uneven, non-"nice" ticks at narrow (mobile) widths.
export function niceStep(roughStep) {
  if (!(roughStep > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const candidates = [1, 2, 2.5, 5, 10].map(m => m * magnitude);
  return candidates.reduce((best, c) => (Math.abs(c - roughStep) < Math.abs(best - roughStep) ? c : best));
}

// Build an explicit, evenly-spaced tick array from 0 up to (at least)
// `maxValue`, at roughly `desiredCount` ticks.
export function niceTicksFromZero(maxValue, desiredCount) {
  if (!(maxValue > 0)) return [0];
  const step = niceStep(maxValue / desiredCount);
  const ticks = [];
  for (let v = 0; v <= maxValue + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

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
