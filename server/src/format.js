// Human-readable formatting for server-generated prose: session narratives and
// notification text. The client has its own unit-aware formatters (it honours
// the per-profile pace/watts/cal-hr preference); these are the plain-pace
// fallbacks for strings the server composes itself.

// Tenths of a second, the convention Concept2 and the rest of the app use:
// 1:58.4 rather than 1:58.
export function formatPace(paceMs) {
  const totalTenths = Math.round(paceMs / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

export function formatDistance(meters) {
  const rounded = Math.round(meters);
  if (rounded >= 1000 && rounded % 1000 === 0) return `${rounded / 1000} km`;
  return `${rounded.toLocaleString('en-GB')} m`;
}

// Elapsed time: 7:23.1, or 1:07:23.1 once it passes an hour.
export function formatDuration(timeMs) {
  const totalTenths = Math.round(timeMs / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = n => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}.${tenths}`
    : `${minutes}:${pad(seconds)}.${tenths}`;
}
