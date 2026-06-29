async function request(path, options = {}) {
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

export const api = {
  getAuthStatus: () => request('/auth/status'),
  logout: () => request('/auth/logout', { method: 'POST' }),

  getWorkouts: (params = {}) => request(`/api/workouts?${new URLSearchParams(params)}`),
  getWorkout: (id) => request(`/api/workouts/${id}`),
  enrichWorkout: (id) => request(`/api/workouts/${id}/enrich`, { method: 'POST' }),

  getSummary: (params = {}) => request(`/api/stats/summary?${new URLSearchParams(params)}`),
  getTrends: (params = {}) => request(`/api/stats/trends?${new URLSearchParams(params)}`),
  getPersonalBests: (params = {}) => request(`/api/stats/personal-bests?${new URLSearchParams(params)}`),
  getFitness: (params = {}) => request(`/api/stats/fitness?${new URLSearchParams(params)}`),
  getCompare: (id1, id2) => request(`/api/stats/compare?ids=${id1},${id2}`),
  getDecayCurve: (params = {}) => request(`/api/stats/decay-curve?${new URLSearchParams(params)}`),

  triggerSync: () => request('/api/sync', { method: 'POST' }),
  getSyncStatus: () => request('/api/sync/status'),

  getSettings: () => request('/api/settings'),
  updateSettings: (data) => request('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
};
