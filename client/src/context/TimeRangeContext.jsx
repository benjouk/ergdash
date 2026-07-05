import { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { PRESETS, computeDateRange } from '../utils/timeRange.js';

const TimeRangeContext = createContext();

// The period selector always opens on this range unless the user has chosen a
// different default in Settings. Stored in localStorage (a per-device view
// preference), so ad-hoc changes in the header stay transient and every reload
// starts from the chosen default.
const DEFAULT_RANGE_STORAGE_KEY = 'ergdash-default-range';
const FALLBACK_DEFAULT_RANGE = '30d';

export function getDefaultRange() {
  try {
    const stored = localStorage.getItem(DEFAULT_RANGE_STORAGE_KEY);
    if (stored && PRESETS[stored]) return stored;
  } catch {
    // localStorage unavailable (private mode / SSR) — fall through to default.
  }
  return FALLBACK_DEFAULT_RANGE;
}

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
  const [defaultRange, setDefaultRangeState] = useState(getDefaultRange);
  const [rangeKey, setRangeKey] = useState(getDefaultRange);

  // Header selection: transient for the session, resets to the default on reload.
  const setRange = useCallback((key) => {
    if (PRESETS[key]) setRangeKey(key);
  }, []);

  // Settings override: persist the default and apply it right away.
  const setDefaultRange = useCallback((key) => {
    if (!PRESETS[key]) return;
    try {
      localStorage.setItem(DEFAULT_RANGE_STORAGE_KEY, key);
    } catch {
      // Preference just won't persist; still honour it for this session.
    }
    setDefaultRangeState(key);
    setRangeKey(key);
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
