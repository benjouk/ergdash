import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { api } from '../api.js';

const TimeRangeContext = createContext();

const PRESETS = {
  '30d': 'Last 30d',
  '90d': 'Last 90d',
  'season': 'This Season',
  'last_season': 'Last Season',
  'all': 'All Time',
};

function computeDateRange(key) {
  const now = new Date();
  if (key === '30d') {
    return { from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: null };
  }
  if (key === '90d') {
    return { from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), to: null };
  }
  if (key === 'season') {
    const seasonStart = now.getMonth() >= 4
      ? `${now.getFullYear()}-05-01`
      : `${now.getFullYear() - 1}-05-01`;
    return { from: seasonStart, to: null };
  }
  if (key === 'last_season') {
    const thisSeasonStart = now.getMonth() >= 4
      ? `${now.getFullYear()}-05-01`
      : `${now.getFullYear() - 1}-05-01`;
    const lastSeasonStart = `${parseInt(thisSeasonStart) - 1}-05-01`;
    return { from: lastSeasonStart, to: thisSeasonStart };
  }
  return { from: null, to: null };
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
