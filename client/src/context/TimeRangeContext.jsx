import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../api.js';
import { PRESETS, computeDateRange } from '../utils/timeRange.js';

const TimeRangeContext = createContext();

// The period selector always opens on the saved default. It lives in account
// settings (not localStorage) so a self-hosted user gets the same default
// across every device. Until the setting loads — and on a fresh install — we
// fall back to the last 30 days.
const FALLBACK_DEFAULT_RANGE = '30d';

function formatShort(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatShortWithYear(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function describeRange(key) {
  const { from, to } = computeDateRange(key);
  if (key === 'all') return 'Full history';
  if (key === 'last_season') return `${formatShortWithYear(from)} – ${formatShortWithYear(to)}`;
  return `Since ${formatShort(from)}`;
}

export function TimeRangeProvider({ children }) {
  const [defaultRange, setDefaultRangeState] = useState(FALLBACK_DEFAULT_RANGE);
  const [rangeKey, setRangeKey] = useState(FALLBACK_DEFAULT_RANGE);

  useEffect(() => {
    let active = true;
    api.getSettings()
      .then(s => {
        if (!active) return;
        if (s.time_range && PRESETS[s.time_range]) {
          setDefaultRangeState(s.time_range);
          setRangeKey(s.time_range);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Header selection: transient for the session, resets to the default on reload.
  const setRange = useCallback((key) => {
    if (PRESETS[key]) setRangeKey(key);
  }, []);

  // Settings override: persist the default to account settings and apply it now.
  const setDefaultRange = useCallback((key) => {
    if (!PRESETS[key]) return Promise.resolve();
    setDefaultRangeState(key);
    setRangeKey(key);
    return api.updateSettings({ time_range: key });
  }, []);

  const { from, to } = useMemo(() => computeDateRange(rangeKey), [rangeKey]);

  return (
    <TimeRangeContext.Provider
      value={{ rangeKey, setRange, defaultRange, setDefaultRange, from, to, PRESETS, describeRange }}
    >
      {children}
    </TimeRangeContext.Provider>
  );
}

export function useTimeRange() {
  return useContext(TimeRangeContext);
}
