// Month-grid math for the Plan view. All arithmetic is UTC so cells line up
// with the ISO dates stored by the server regardless of browser timezone.

const DAY_MS = 86400000;

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// month is 0-based. Returns full weeks covering the month, aligned to the
// user's week start, plus the [from, to) range to fetch for the grid.
export function monthGrid(year, month, weekStart = 'monday') {
  const first = Date.UTC(year, month, 1);
  const firstDow = weekStart === 'sunday'
    ? new Date(first).getUTCDay()
    : (new Date(first).getUTCDay() + 6) % 7;
  const start = first - firstDow * DAY_MS;
  const lastOfMonth = Date.UTC(year, month + 1, 0);

  const weeks = [];
  let cursor = start;
  while (cursor <= lastOfMonth) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        date: isoDay(cursor),
        inMonth: new Date(cursor).getUTCMonth() === month,
      });
      cursor += DAY_MS;
    }
    weeks.push(week);
  }

  return { weeks, from: weeks[0][0].date, to: isoDay(cursor) };
}

export function shiftMonth(year, month, delta) {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function monthLabel(year, month) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export function weekdayLabels(weekStart = 'monday') {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return weekStart === 'sunday' ? ['Sun', ...labels.slice(0, 6)] : labels;
}

// The seven ISO dates of the week containing `isoDate`, aligned to the user's
// week start. UTC math, matching monthGrid, so it lines up with server dates.
export function weekOf(isoDate, weekStart = 'monday') {
  const base = Date.parse(isoDate);
  const dow = weekStart === 'sunday'
    ? new Date(base).getUTCDay()
    : (new Date(base).getUTCDay() + 6) % 7;
  const start = base - dow * DAY_MS;
  const days = [];
  for (let i = 0; i < 7; i++) days.push(isoDay(start + i * DAY_MS));
  return days;
}
