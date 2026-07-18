export const PROGRESS_VIEWS = ['overview', 'training', 'performance', 'technique'];

export function normalizeProgressView(value) {
  return PROGRESS_VIEWS.includes(value) ? value : 'overview';
}

// Prefer the nearest upcoming race, then an undated active target, then a past
// target. The same rule feeds both the compact Overview card and Performance.
export function selectPrimaryTarget(goals = []) {
  const active = goals.filter(goal => goal?.kind === 'performance' && goal.active);
  return [...active].sort((a, b) => targetPriority(a) - targetPriority(b))[0] || null;
}

function targetPriority(goal) {
  const days = goal.progress?.days_to_race;
  if (days != null && days >= 0) return days;
  if (!goal.race_date) return 100000;
  return 200000 + Math.abs(days || 0);
}

export function rollingMetric(rows = [], key, window = 7, minimum = 3) {
  const values = rows
    .map(row => (typeof row === 'number' ? row : row?.[key]))
    .filter(value => Number.isFinite(value));
  if (values.length < minimum) return { available: false, value: null, delta: null, count: values.length };

  const rolling = values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - window + 1), index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
  return {
    available: true,
    value: rolling[rolling.length - 1],
    delta: rolling[rolling.length - 1] - rolling[0],
    count: values.length,
  };
}

export function buildTechniqueSummaries(data = {}) {
  const discipline = rollingMetric(data.discipline, 'rate_discipline');
  const consistency = rollingMetric(data.consistency, 'consistency');

  return {
    efficiency: rollingMetric(data.efficiency, 'watts_per_beat'),
    hr_drift: rollingMetric(data.hr_drift, 'hr_drift_pct', 1),
    dps: rollingMetric(data.dps, 'dps'),
    stroke_quality: {
      available: discipline.available || consistency.available,
      value: discipline.value,
      secondaryValue: consistency.value,
      delta: discipline.delta,
      secondaryDelta: consistency.delta,
      count: Math.max(discipline.count, consistency.count),
    },
    drag: rollingMetric(data.drag, 'drag_factor', 1, 2),
  };
}
