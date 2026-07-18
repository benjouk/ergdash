import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

const PrefsContext = createContext();

const DEFAULT_PREFS = {
  default_landing: '/',
  feed_limit: '50',
  week_start: 'monday',
  date_format: 'day-month',
  weight_kg: '',
  sex: '',
  birth_year: '',
};

const VALID_VALUES = {
  default_landing: ['/', '/progress', '/workouts'],
  week_start: ['monday', 'sunday'],
  date_format: ['day-month', 'month-day'],
  sex: ['', 'M', 'F'],
};

function normalizePrefs(settings = {}) {
  const prefs = { ...DEFAULT_PREFS };
  for (const key of Object.keys(DEFAULT_PREFS)) {
    const value = settings[key];
    if (value == null) continue;
    if (VALID_VALUES[key] && !VALID_VALUES[key].includes(value)) continue;
    if (key === 'feed_limit') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) prefs.feed_limit = String(Math.round(parsed));
      continue;
    }
    if (key === 'weight_kg') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) prefs.weight_kg = String(parsed);
      continue;
    }
    if (key === 'birth_year') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 1900) prefs.birth_year = String(parsed);
      continue;
    }
    prefs[key] = value;
  }
  return prefs;
}

export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  useEffect(() => {
    api.getSettings()
      .then(settings => setPrefs(normalizePrefs(settings)))
      .catch(() => {});
  }, []);

  const updatePref = useCallback((key, value) => {
    const nextPrefs = normalizePrefs({ ...prefs, [key]: String(value) });
    setPrefs(nextPrefs);
    return api.updateSettings({ [key]: nextPrefs[key] });
  }, [prefs]);

  return (
    <PrefsContext.Provider
      value={{
        defaultLanding: prefs.default_landing,
        feedLimit: Number(prefs.feed_limit) || 50,
        weekStart: prefs.week_start,
        dateFormat: prefs.date_format,
        weightKg: Number(prefs.weight_kg) > 0 ? Number(prefs.weight_kg) : null,
        sex: prefs.sex || null,
        birthYear: Number(prefs.birth_year) >= 1900 ? Number(prefs.birth_year) : null,
        updatePref,
      }}
    >
      {children}
    </PrefsContext.Provider>
  );
}

export const usePrefs = () => useContext(PrefsContext);
