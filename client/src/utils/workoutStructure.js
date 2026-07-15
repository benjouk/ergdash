// Display helpers for the legacy `inferred_tag` structural classification.
//
// `inferred_tag` has two stored values, 'endurance' and 'interval', but
// 'endurance' is a purely *structural* label: it means the workout had no
// detected rest and wasn't a Concept2 interval type. It says nothing about
// training intensity. We surface it as "Continuous" so users don't read it as
// aerobic/steady-state effort. The stored value is unchanged.

const STRUCTURE_LABELS = {
  endurance: 'Continuous',
  interval: 'Intervals',
};

const STRUCTURE_TOOLTIPS = {
  endurance: 'Continuous means the workout did not contain detected rest intervals. It does not describe training intensity.',
  interval: 'Intervals means the workout contained repeated work and rest periods or was identified by Concept2 as an interval workout.',
};

export function structureLabel(tag) {
  return STRUCTURE_LABELS[tag] || STRUCTURE_LABELS.endurance;
}

export function structureTooltip(tag) {
  return STRUCTURE_TOOLTIPS[tag] || STRUCTURE_TOOLTIPS.endurance;
}
