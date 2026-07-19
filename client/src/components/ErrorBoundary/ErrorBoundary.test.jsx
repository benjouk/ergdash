import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorFallback, isStaleChunkError } from './ErrorBoundary.jsx';

describe('isStaleChunkError', () => {
  it('recognises failed dynamic imports from a stale deploy', () => {
    expect(isStaleChunkError(new Error('Failed to fetch dynamically imported module: /assets/Plan-abc123.js'))).toBe(true);
    expect(isStaleChunkError(new Error('Loading chunk 42 failed'))).toBe(true);
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('treats everything else as a real error', () => {
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe('ErrorFallback', () => {
  it('offers a reload for stale-chunk errors without alarming language', () => {
    const markup = renderToStaticMarkup(
      <ErrorFallback error={new Error('Failed to fetch dynamically imported module: /assets/Plan-abc123.js')} />
    );
    expect(markup).toContain('ErgDash was updated');
    expect(markup).toContain('Reload');
    expect(markup).not.toContain('Something went wrong');
  });

  it('shows the error message for real render errors', () => {
    const markup = renderToStaticMarkup(<ErrorFallback error={new Error('boom')} />);
    expect(markup).toContain('Something went wrong');
    expect(markup).toContain('boom');
  });

  it('copes with an error that has no message', () => {
    const markup = renderToStaticMarkup(<ErrorFallback error={{}} />);
    expect(markup).toContain('An unexpected error occurred.');
  });
});
