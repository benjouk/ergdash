function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Parse a YYYY-MM-DD key as a local date (new Date('YYYY-MM-DD') would be UTC
// midnight, which shifts a day in negative-offset timezones).
function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayLabel(dateKey, dateFormat, now = new Date()) {
  const todayKey = toDateKey(now);
  if (dateKey === todayKey) return 'Today';
  const yesterdayKey = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (dateKey === yesterdayKey) return 'Yesterday';

  const date = fromDateKey(dateKey);
  const locale = dateFormat === 'month-day' ? 'en-US' : 'en-GB';
  const options = { weekday: 'short', day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString(locale, options);
}

// Groups a date-sorted workout list into one group per calendar day,
// preserving the incoming order. Workout dates are datetime strings
// ("YYYY-MM-DD HH:MM:SS"), so the day key is the leading date part.
export function groupByDay(workouts, dateFormat, now = new Date()) {
  const groups = [];
  let current = null;
  for (const w of workouts) {
    const key = String(w.date).slice(0, 10);
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(key, dateFormat, now), items: [] };
      groups.push(current);
    }
    current.items.push(w);
  }
  return groups;
}
