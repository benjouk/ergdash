function defaultLayoutFor(registry) {
  return {
    version: 1,
    charts: registry.map(({ id, defaultHidden }) => ({ id, hidden: Boolean(defaultHidden) })),
  };
}

export function mergeLayout(savedJsonString, registry) {
  const registryIds = new Set(registry.map(({ id }) => id));
  const fallback = defaultLayoutFor(registry);

  if (!savedJsonString) {
    return fallback;
  }

  let saved;
  try {
    saved = JSON.parse(savedJsonString);
  } catch {
    return fallback;
  }

  if (!saved || !Array.isArray(saved.charts)) {
    return fallback;
  }

  const seen = new Set();
  const savedCharts = [];

  saved.charts.forEach((chart) => {
    if (!chart || !registryIds.has(chart.id) || seen.has(chart.id)) {
      return;
    }

    seen.add(chart.id);
    savedCharts.push({ id: chart.id, hidden: Boolean(chart.hidden) });
  });

  // Charts the saved layout doesn't know about come in at their registry
  // default, so a chart shipped hidden-by-default stays hidden until the
  // user opts in - while explicit saved choices always win.
  const missingCharts = registry
    .filter(({ id }) => !seen.has(id))
    .map(({ id, defaultHidden }) => ({ id, hidden: Boolean(defaultHidden) }));

  return {
    version: 1,
    charts: [...savedCharts, ...missingCharts],
  };
}

export function buildRows(layout, registry) {
  const chartsById = new Map(registry.map(chart => [chart.id, chart]));
  const rows = [];
  let pendingHalfRow = [];

  layout.charts.forEach((layoutChart) => {
    if (layoutChart.hidden) {
      return;
    }

    const chart = chartsById.get(layoutChart.id);
    if (!chart) {
      return;
    }

    if (chart.width === 'full') {
      if (pendingHalfRow.length > 0) {
        rows.push(pendingHalfRow);
        pendingHalfRow = [];
      }
      rows.push([chart]);
      return;
    }

    pendingHalfRow.push(chart);
    if (pendingHalfRow.length === 2) {
      rows.push(pendingHalfRow);
      pendingHalfRow = [];
    }
  });

  if (pendingHalfRow.length > 0) {
    rows.push(pendingHalfRow);
  }

  return rows;
}

// Titled sections for the Progress page: groups render in the fixed order
// given, charts keep the user's layout order within their group. Groups with
// nothing visible are omitted. Charts whose group isn't listed fall into a
// trailing catch-all so a registry mistake can't hide a chart.
export function buildSections(layout, registry, groups) {
  const groupById = new Map(registry.map(chart => [chart.id, chart.group]));
  const knownGroups = new Set(groups.map(group => group.id));

  const sections = [];
  for (const group of groups) {
    const groupLayout = {
      ...layout,
      charts: layout.charts.filter(chart => groupById.get(chart.id) === group.id),
    };
    const rows = buildRows(groupLayout, registry);
    if (rows.length > 0) {
      sections.push({ id: group.id, label: group.label, rows });
    }
  }

  const orphanLayout = {
    ...layout,
    charts: layout.charts.filter(chart => (
      groupById.has(chart.id) && !knownGroups.has(groupById.get(chart.id))
    )),
  };
  const orphanRows = buildRows(orphanLayout, registry);
  if (orphanRows.length > 0) {
    sections.push({ id: 'other', label: 'Other', rows: orphanRows });
  }

  return sections;
}

export function toggleHidden(layout, id) {
  return {
    version: 1,
    charts: layout.charts.map(chart => (
      chart.id === id
        ? { ...chart, hidden: !chart.hidden }
        : { ...chart }
    )),
  };
}
