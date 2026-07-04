import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

const UnitsContext = createContext();

export function UnitsProvider({ children }) {
  const [units, setUnits] = useState('pace');

  useEffect(() => {
    api.getSettings()
      .then(settings => {
        if (['pace', 'watts', 'calhr'].includes(settings.units)) {
          setUnits(settings.units);
        }
      })
      .catch(() => {});
  }, []);

  const updateUnits = useCallback((nextUnits) => {
    setUnits(nextUnits);
    return api.updateSettings({ units: nextUnits });
  }, []);

  const formatPace = useCallback((paceMs) => {
    if (!paceMs || paceMs <= 0) return '--';

    if (units === 'watts') {
      const paceSeconds = paceMs / 1000;
      const watts = Math.round(2.80 / Math.pow(paceSeconds / 500, 3));
      return `${watts}W`;
    }

    if (units === 'calhr') {
      const paceSeconds = paceMs / 1000;
      const watts = 2.80 / Math.pow(paceSeconds / 500, 3);
      const calhr = Math.round(watts * 0.86 + 300);
      return `${calhr} Cal/hr`;
    }

    const totalSeconds = paceMs / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
  }, [units]);

  const formatDistance = useCallback((meters) => {
    if (!meters) return '--';
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)}k`;
    }
    return `${meters}m`;
  }, []);

  const formatDistanceFull = useCallback((meters) => {
    if (!meters) return '--';
    return `${meters.toLocaleString()}m`;
  }, []);

  const formatTime = useCallback((timeMs) => {
    if (!timeMs || timeMs <= 0) return '--';
    const totalSeconds = Math.round(timeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }, []);

  return (
    <UnitsContext.Provider value={{ units, setUnits: updateUnits, formatPace, formatDistance, formatDistanceFull, formatTime }}>
      {children}
    </UnitsContext.Provider>
  );
}

export const useUnits = () => useContext(UnitsContext);
