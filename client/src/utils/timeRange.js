export const PRESETS = {
  '30d': 'Last 30d',
  '90d': 'Last 90d',
  'season': 'This Season',
  'last_season': 'Last Season',
  'all': 'All Time',
};

export function computeDateRange(key) {
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
