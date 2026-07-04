import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('system');

  useEffect(() => {
    api.getSettings()
      .then(settings => {
        if (['system', 'light', 'dark'].includes(settings.theme)) {
          setThemeState(settings.theme);
        }
      })
      .catch(() => {});
  }, []);

  const resolveTheme = useCallback((t) => {
    if (t === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return t;
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(theme));
  }, [theme, resolveTheme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      document.documentElement.setAttribute('data-theme', resolveTheme('system'));
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, resolveTheme]);

  const setTheme = useCallback((t) => {
    setThemeState(t);
    return api.updateSettings({ theme: t });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const resolved = resolveTheme(prev);
      const next = resolved === 'dark' ? 'light' : 'dark';
      api.updateSettings({ theme: next }).catch(() => {});
      return next;
    });
  }, [resolveTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
