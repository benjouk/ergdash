import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, getActiveProfileId, setActiveProfileId } from '../api.js';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setIsAuthenticated(status.authenticated);
      const list = status.profiles || [];
      setProfiles(list);

      // The OAuth callback redirects to /?connected=<profileId>; adopt that
      // profile so the person who just connected lands on their own data.
      const connectedParam = new URLSearchParams(window.location.search).get('connected');
      if (connectedParam && list.some(p => String(p.id) === connectedParam)) {
        setActiveProfileId(connectedParam);
      }

      // Validate the stored selection against the live list; fall back to the
      // first profile (matching the server middleware's fallback).
      const storedId = getActiveProfileId();
      const active = list.find(p => String(p.id) === storedId) || list[0] || null;
      if (active && String(active.id) !== storedId) setActiveProfileId(active.id);
      setActiveProfile(active);
    } catch {
      setIsAuthenticated(false);
      setProfiles([]);
      setActiveProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // A full reload is the simplest correct cache invalidation: every context
  // and view refetches under the new X-Profile-Id.
  const switchProfile = useCallback((id) => {
    setActiveProfileId(id);
    window.location.reload();
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setIsAuthenticated(false);
    setProfiles([]);
    setActiveProfile(null);
  }, []);

  // `user` keeps its old meaning (the connected Concept2 identity) for the
  // views that still read it, now scoped to the active profile.
  const user = activeProfile?.user || null;

  return (
    <AuthContext.Provider value={{
      user,
      profiles,
      activeProfile,
      switchProfile,
      isAuthenticated,
      isLoading,
      logout,
      checkAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
