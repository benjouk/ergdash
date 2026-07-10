import { describe, expect, it } from 'vitest';
import {
  escapeLikePattern,
  validateDistanceRange,
  validatePaginationParams,
} from '../src/middleware/validate.js';

describe('escapeLikePattern', () => {
  it('leaves a plain string unchanged', () => {
    expect(escapeLikePattern('steady row')).toBe('steady row');
  });

  it('escapes percent wildcards', () => {
    expect(escapeLikePattern('100% effort')).toBe('100\\% effort');
  });

  it('escapes underscore wildcards', () => {
    expect(escapeLikePattern('rate_24')).toBe('rate\\_24');
  });

  it('escapes backslashes', () => {
    expect(escapeLikePattern('notes\\today')).toBe('notes\\\\today');
  });

  it('escapes mixed wildcard characters', () => {
    expect(escapeLikePattern('50%_done\\ok')).toBe('50\\%\\_done\\\\ok');
  });

  it('handles an empty string', () => {
    expect(escapeLikePattern('')).toBe('');
  });
});

function runMiddleware(middleware, query) {
  const result = { status: null, body: null, next: false };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; },
  };
  middleware({ query }, res, () => { result.next = true; });
  return result;
}

describe('numeric query validation', () => {
  it('rejects partially numeric pagination values', () => {
    expect(runMiddleware(validatePaginationParams, { limit: '20x' }))
      .toMatchObject({ status: 400, next: false });
    expect(runMiddleware(validatePaginationParams, { offset: '1.5' }))
      .toMatchObject({ status: 400, next: false });
  });

  it('rejects partially numeric distance values', () => {
    expect(runMiddleware(validateDistanceRange, { min_distance: '2000m' }))
      .toMatchObject({ status: 400, next: false });
  });

  it('accepts complete non-negative integers', () => {
    expect(runMiddleware(validatePaginationParams, { limit: '20', offset: '0' }).next).toBe(true);
    expect(runMiddleware(validateDistanceRange, { min_distance: '0', max_distance: '2000' }).next).toBe(true);
  });
});
