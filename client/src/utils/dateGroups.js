function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function groupByRecency(workouts) {
  const now = new Date();
  const todayKey = toDateKey(now);
  const yesterdayKey = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const weekAgoKey = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));

  const buckets = { today: [], yesterday: [], last7: [], older: [] };
  for (const w of workouts) {
    if (w.date === todayKey) buckets.today.push(w);
    else if (w.date === yesterdayKey) buckets.yesterday.push(w);
    else if (w.date > weekAgoKey) buckets.last7.push(w);
    else buckets.older.push(w);
  }

  return [
    { label: 'Today', items: buckets.today },
    { label: 'Yesterday', items: buckets.yesterday },
    { label: 'Previous 7 Days', items: buckets.last7 },
    { label: 'Older', items: buckets.older },
  ].filter(g => g.items.length > 0);
}
