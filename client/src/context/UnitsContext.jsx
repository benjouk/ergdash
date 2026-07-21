import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { useProfileQuery } from '../hooks/useProfileQuery.js';
import { paceToWatts, wattsToCalHr } from '../utils/ergMath.js';

const UnitsContext = createContext();

export function UnitsProvider({ children }) {
  const [units, setUnits] = useState('pace');
  const { data: settings } = useProfileQuery(['settings'], api.getSettings);

  useEffect(() => {
    if (['pace', 'watts', 'calhr'].includes(settings?.units)) {
      setUnits(settings.units);
    }
  }, [settings]);

  const updateUnits = useCallback((nextUnits) => {
    setUnits(nextUnits);
    return api.updateSettings({ units: nextUnits });
  }, []);

  const formatPace = useCallback((paceMs) => {
    if (!paceMs || paceMs <= 0) return '--';

    if (units === 'watts') {
      const watts = Math.round(paceToWatts(paceMs / 1000));
      return `${watts}W`;
    }

    if (units === 'calhr') {
      const calhr = Math.round(wattsToCalHr(paceToWatts(paceMs / 1000)));
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
