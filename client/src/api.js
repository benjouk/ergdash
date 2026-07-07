async function request(path, options = {}) {
  if (import.meta.env.VITE_DEMO === '1') {
    const { demoRequest } = await import('./demoApi.js');
    return demoRequest(path, options);
  }

  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
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

async function uploadSqlite(path, file) {
  if (import.meta.env.VITE_DEMO === '1') {
    throw new Error('Demo mode — run ErgDash self-hosted to restore a backup');
  }

  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
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

  getWorkouts: (params = {}) => request(`/api/workouts?${new URLSearchParams(params)}`),
  getWorkout: (id) => request(`/api/workouts/${id}`),
  updateWorkout: (id, data) => request(`/api/workouts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  enrichWorkout: (id) => request(`/api/workouts/${id}/enrich`, { method: 'POST' }),

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

  getPredictions: () => request('/api/stats/predictions'),

  getGoals: () => request('/api/goals'),
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

  getWeeklyInsight: () => request('/api/insights/weekly'),

  triggerSync: () => request('/api/sync', { method: 'POST' }),
  getSyncStatus: () => request('/api/sync/status'),

  getSettings: () => request('/api/settings'),
  updateSettings: (data) => request('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  resetSettings: () => request('/api/settings/reset', { method: 'POST' }),
  restoreDatabase: (file) => uploadSqlite('/api/admin/restore', file),
  disconnectAccount: () => request('/api/admin/disconnect', { method: 'POST' }),
  wipeLocalData: () => request('/api/admin/wipe', { method: 'POST' }),
};
