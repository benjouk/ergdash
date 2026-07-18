import { describe, expect, it } from 'vitest';
import { buildRows, buildSections, mergeLayout, toggleHidden } from './progressLayout.js';

const registry = [
  { id: 'fitness', width: 'full' },
  { id: 'pace', width: 'half' },
  { id: 'volume', width: 'half' },
  { id: 'power', width: 'half' },
  { id: 'zones', width: 'half' },
  { id: 'fade', width: 'full' },
];

function ids(layout) {
  return layout.charts.map(chart => chart.id);
}

function rowIds(rows) {
  return rows.map(row => row.map(chart => chart.id));
}

describe('mergeLayout', () => {
  it('returns the default layout for null input', () => {
    const layout = mergeLayout(null, registry);

    expect(layout).toEqual({
      version: 1,
      charts: registry.map(({ id }) => ({ id, hidden: false })),
    });
  });

  it('returns the default layout for invalid JSON', () => {
    expect(ids(mergeLayout('{bad json', registry))).toEqual(ids(mergeLayout(null, registry)));
  });

  it('respects defaultHidden for fresh layouts and unseen charts, but not saved choices', () => {
    const withDefault = [
      { id: 'fitness', width: 'full' },
      { id: 'volume', width: 'half', defaultHidden: true },
      { id: 'pace', width: 'half' },
    ];

    // Fresh layout: the chart starts hidden.
    expect(mergeLayout(null, withDefault).charts).toEqual([
      { id: 'fitness', hidden: false },
      { id: 'volume', hidden: true },
      { id: 'pace', hidden: false },
    ]);

    // Saved layout that never saw the chart: it merges in hidden.
    const merged = mergeLayout(JSON.stringify({
      charts: [{ id: 'fitness', hidden: false }],
    }), withDefault);
    expect(merged.charts.find(chart => chart.id === 'volume').hidden).toBe(true);

    // An explicit saved choice always wins over the default.
    const explicit = mergeLayout(JSON.stringify({
      charts: [{ id: 'volume', hidden: false }],
    }), withDefault);
    expect(explicit.charts.find(chart => chart.id === 'volume').hidden).toBe(false);
  });

  it('drops unknown and duplicate ids', () => {
    const layout = mergeLayout(JSON.stringify({
      version: 1,
      charts: [
        { id: 'ghost', hidden: true },
        { id: 'volume', hidden: true },
        { id: 'volume', hidden: false },
      ],
    }), registry);

    expect(layout.charts[0]).toEqual({ id: 'volume', hidden: true });
    expect(ids(layout)).toEqual(['volume', 'fitness', 'pace', 'power', 'zones', 'fade']);
  });

  it('appends missing ids in their registry order', () => {
    const layout = mergeLayout(JSON.stringify({
      charts: [
        { id: 'zones', hidden: true },
        { id: 'pace', hidden: false },
      ],
    }), registry);

    expect(layout).toEqual({
      version: 1,
      charts: [
        { id: 'zones', hidden: true },
        { id: 'pace', hidden: false },
        { id: 'fitness', hidden: false },
        { id: 'volume', hidden: false },
        { id: 'power', hidden: false },
        { id: 'fade', hidden: false },
      ],
    });
  });
});

describe('buildRows', () => {
  it('creates full-width rows and pairs consecutive half-width charts', () => {
    const rows = buildRows(mergeLayout(null, registry), registry);

    expect(rowIds(rows)).toEqual([
      ['fitness'],
      ['pace', 'volume'],
      ['power', 'zones'],
      ['fade'],
    ]);
  });

  it('renders an odd trailing half-width chart alone', () => {
    const rows = buildRows({
      version: 1,
      charts: [
        { id: 'fitness', hidden: true },
        { id: 'pace', hidden: false },
        { id: 'volume', hidden: false },
        { id: 'power', hidden: false },
        { id: 'zones', hidden: true },
        { id: 'fade', hidden: true },
      ],
    }, registry);

    expect(rowIds(rows)).toEqual([
      ['pace', 'volume'],
      ['power'],
    ]);
  });
});

describe('buildSections', () => {
  const grouped = [
    { id: 'fitness', width: 'full', group: 'load' },
    { id: 'pace', width: 'half', group: 'speed' },
    { id: 'volume', width: 'half', group: 'load' },
    { id: 'power', width: 'half', group: 'speed' },
    { id: 'zones', width: 'half', group: 'load' },
    { id: 'fade', width: 'full', group: 'speed' },
  ];
  const groups = [
    { id: 'load', label: 'Training Load' },
    { id: 'speed', label: 'Speed & Racing' },
  ];

  it('renders groups in fixed order, charts in layout order within them', () => {
    const layout = mergeLayout(JSON.stringify({
      charts: [
        { id: 'fade', hidden: false },
        { id: 'zones', hidden: false },
        { id: 'volume', hidden: false },
      ],
    }), grouped);

    const sections = buildSections(layout, grouped, groups);
    expect(sections.map(section => section.id)).toEqual(['load', 'speed']);
    // User put zones before volume; fitness (unseen) merged in after.
    expect(rowIds(sections[0].rows)).toEqual([['zones', 'volume'], ['fitness']]);
    expect(rowIds(sections[1].rows)).toEqual([['fade'], ['pace', 'power']]);
  });

  it('omits groups with nothing visible', () => {
    const layout = {
      version: 1,
      charts: grouped.map(({ id }) => ({ id, hidden: id !== 'pace' })),
    };
    const sections = buildSections(layout, grouped, groups);
    expect(sections.map(section => section.id)).toEqual(['speed']);
  });

  it('collects charts with unknown groups into a trailing Other section', () => {
    const registryWithStray = [...grouped, { id: 'stray', width: 'half', group: 'mystery' }];
    const layout = mergeLayout(null, registryWithStray);
    const sections = buildSections(layout, registryWithStray, groups);
    expect(sections[sections.length - 1].id).toBe('other');
    expect(rowIds(sections[sections.length - 1].rows)).toEqual([['stray']]);
  });
});

describe('toggleHidden', () => {
  it('toggles only the requested chart', () => {
    const layout = toggleHidden(mergeLayout(null, registry), 'pace');

    expect(layout.charts.find(chart => chart.id === 'pace').hidden).toBe(true);
    expect(layout.charts.find(chart => chart.id === 'volume').hidden).toBe(false);
  });
});
