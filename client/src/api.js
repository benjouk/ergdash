// The active household profile, chosen client-side and sent with every API
// call. The server falls back to the first profile when the header is absent.
export function getActiveProfileId() {
  return localStorage.getItem('ergdash_profile') || '';
}

export function setActiveProfileId(id) {
  if (id == null || id === '') localStorage.removeItem('ergdash_profile');
  else localStorage.setItem('ergdash_profile', String(id));
}

function profileHeaders() {
  const id = getActiveProfileId();
  return id ? { 'X-Profile-Id': id } : {};
}

async function request(path, options = {}) {
  if (import.meta.env.VITE_DEMO === '1') {
    const { demoRequest } = await import('./demoApi.js');
    return demoRequest(path, options);
  }

  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...profileHeaders(), ...options.headers },
    ...options,
  });

  if (res.status === 401) {
    throw new Error('Not authenticated');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

async function uploadRaw(path, file, demoMessage) {
  if (import.meta.env.VITE_DEMO === '1') {
    throw new Error(demoMessage);
  }

  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream', ...profileHeaders() },
    body: file,
  });

  if (res.status === 401) {
    throw new Error('Not authenticated');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

export const api = {
  getAuthStatus: () => request('/auth/status'),
  logout: () => request('/auth/logout', { method: 'POST' }),

  getProfiles: () => request('/api/profiles'),
  renameProfile: (id, name) => request(`/api/profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  }),
  disconnectProfile: (id) => request(`/api/profiles/${id}/disconnect`, { method: 'POST' }),
  deleteProfile: (id) => request(`/api/profiles/${id}`, { method: 'DELETE' }),

  getWorkouts: (params = {}) => request(`/api/workouts?${new URLSearchParams(params)}`),
  getWorkout: (id) => request(`/api/workouts/${id}`),
  getComparisonCandidates: (id, params = {}) => request(`/api/workouts/${id}/comparison-candidates?${new URLSearchParams(params)}`),
  createWorkout: (data) => request('/api/workouts', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateWorkout: (id, data) => request(`/api/workouts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  deleteWorkout: (id) => request(`/api/workouts/${id}`, { method: 'DELETE' }),
  revertWorkout: (id, fields = null) => request(`/api/workouts/${id}/revert`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  }),
  enrichWorkout: (id) => request(`/api/workouts/${id}/enrich`, { method: 'POST' }),

  previewImport: (file, format) => uploadRaw(
    `/api/import/preview?format=${encodeURIComponent(format)}&filename=${encodeURIComponent(file.name)}`,
    file,
    'Demo mode - run ErgDash self-hosted to import workout files',
  ),
  commitImport: (payload) => request('/api/import/commit', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  getSummary: (params = {}) => request(`/api/stats/summary?${new URLSearchParams(params)}`),
  getTrends: (params = {}) => request(`/api/stats/trends?${new URLSearchParams(params)}`),
  getPersonalBests: (params = {}) => request(`/api/stats/personal-bests?${new URLSearchParams(params)}`),
  getPbHistory: (params = {}) => request(`/api/stats/pb-history?${new URLSearchParams(params)}`),
  getFitness: (params = {}) => request(`/api/stats/fitness?${new URLSearchParams(params)}`),
  getCompare: (id1, id2) => request(`/api/stats/compare?ids=${id1},${id2}`),
  getDecayCurve: (params = {}) => request(`/api/stats/decay-curve?${new URLSearchParams(params)}`),
  getCalendar: (params = {}) => request(`/api/stats/calendar?${new URLSearchParams(params)}`),
  getCumulative: (params = {}) => request(`/api/stats/cumulative?${new URLSearchParams(params)}`),
  getPowerCurve: (params = {}) => request(`/api/stats/power-curve?${new URLSearchParams(params)}`),
  getZones: (params = {}) => request(`/api/stats/zones?${new URLSearchParams(params)}`),
  getPolarization: (params = {}) => request(`/api/stats/polarization?${new URLSearchParams(params)}`),


  getGoals: () => request('/api/goals'),
  getRacePlan: (id) => request(`/api/goals/${id}/race-plan`),
  createGoal: (data) => request('/api/goals', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateGoal: (id, data) => request(`/api/goals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  deleteGoal: (id) => request(`/api/goals/${id}`, { method: 'DELETE' }),

  getPlans: (params = {}) => request(`/api/plans?${new URLSearchParams(params)}`),
  createPlan: (data) => request('/api/plans', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updatePlan: (id, data) => request(`/api/plans/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  deletePlan: (id) => request(`/api/plans/${id}`, { method: 'DELETE' }),
  matchPlan: (id, workoutId) => request(`/api/plans/${id}/match`, {
    method: 'POST',
    body: JSON.stringify({ workout_id: workoutId }),
  }),
  unmatchPlan: (id) => request(`/api/plans/${id}/match`, { method: 'DELETE' }),
  getPlanAdherence: (params = {}) => request(`/api/plans/adherence?${new URLSearchParams(params)}`),

  getProgramPresets: () => request('/api/programs/presets'),
  getPrograms: () => request('/api/programs'),
  createProgram: (data) => request('/api/programs', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateProgram: (id, data) => request(`/api/programs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  shiftProgram: (id, weeks) => request(`/api/programs/${id}/shift`, {
    method: 'POST',
    body: JSON.stringify({ weeks }),
  }),
  deleteProgram: (id) => request(`/api/programs/${id}`, { method: 'DELETE' }),

  getWeeklyInsight: () => request('/api/insights/weekly'),

  triggerSync: () => request('/api/sync', { method: 'POST' }),
  getSyncStatus: () => request('/api/sync/status'),

  getSettings: () => request('/api/settings'),
  updateSettings: (data) => request('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  resetSettings: () => request('/api/settings/reset', { method: 'POST' }),
  restoreDatabase: (file) => uploadRaw('/api/admin/restore', file, 'Demo mode - run ErgDash self-hosted to restore a backup'),
  restoreBackup: (file) => uploadRaw('/api/admin/restore-data', file, 'Demo mode - run ErgDash self-hosted to restore a backup'),
  // First-run restore on a fresh install (no session/profile yet), before any
  // Concept2 connection. Creates the profile, restores the data, and logs in.
  bootstrapRestore: (file) => uploadRaw('/auth/restore-bootstrap', file, 'Demo mode - run ErgDash self-hosted to restore a backup'),
  // Fetched (not a plain <a href>) so the X-Profile-Id header goes with it and
  // the backup is scoped to the active profile, not the fallback first one.
  downloadBackup: async () => {
    if (import.meta.env.VITE_DEMO === '1') {
      throw new Error('Demo mode - run ErgDash self-hosted to back up your data');
    }
    const res = await fetch('/api/admin/backup-data', {
      credentials: 'include',
      headers: { ...profileHeaders() },
    });
    if (res.status === 401) throw new Error('Not authenticated');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `API error: ${res.status}`);
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: await res.blob(), filename: match ? match[1] : 'ergdash-data-backup.json' };
  },
  disconnectAccount: () => request('/api/admin/disconnect', { method: 'POST' }),
  wipeLocalData: () => request('/api/admin/wipe', { method: 'POST' }),
};
