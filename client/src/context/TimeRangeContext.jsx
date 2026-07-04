import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { api } from '../api.js';
import { PRESETS, computeDateRange } from '../utils/timeRange.js';

const TimeRangeContext = createContext();

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
  const [rangeKey, setRangeKey] = useState('all');

  useEffect(() => {
    api.getSettings()
      .then(s => { if (s.time_range && PRESETS[s.time_range]) setRangeKey(s.time_range); })
      .catch(() => {});
  }, []);

  const setRange = (key) => {
    setRangeKey(key);
    api.updateSettings({ time_range: key }).catch(() => {});
  };

  const { from, to } = useMemo(() => computeDateRange(rangeKey), [rangeKey]);

  return (
    <TimeRangeContext.Provider value={{ rangeKey, setRange, from, to, PRESETS, describeRange }}>
      {children}
    </TimeRangeContext.Provider>
  );
}

export function useTimeRange() {
  return useContext(TimeRangeContext);
}
