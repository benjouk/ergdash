import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageHeader from './PageHeader.jsx';

describe('PageHeader', () => {
  it('gives every top-level page a level-one heading', () => {
    const markup = renderToStaticMarkup(<PageHeader title="Dashboard" subtitle="Overview" />);

    expect(markup).toContain('<h1');
    expect(markup).toContain('Dashboard</h1>');
    expect(markup).not.toContain('<h2');
  });
});
