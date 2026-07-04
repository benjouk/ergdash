function defaultLayoutFor(registry) {
  return {
    version: 1,
    charts: registry.map(({ id }) => ({ id, hidden: false })),
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

  const missingCharts = registry
    .filter(({ id }) => !seen.has(id))
    .map(({ id }) => ({ id, hidden: false }));

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
