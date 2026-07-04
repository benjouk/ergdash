import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from '../src/middleware/validate.js';

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
