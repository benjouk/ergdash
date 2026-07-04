import { describe, expect, it } from 'vitest';
import { buildRows, mergeLayout, toggleHidden } from './progressLayout.js';

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

describe('toggleHidden', () => {
  it('toggles only the requested chart', () => {
    const layout = toggleHidden(mergeLayout(null, registry), 'pace');

    expect(layout.charts.find(chart => chart.id === 'pace').hidden).toBe(true);
    expect(layout.charts.find(chart => chart.id === 'volume').hidden).toBe(false);
  });
});
