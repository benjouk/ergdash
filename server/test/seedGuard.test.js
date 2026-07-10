import { describe, expect, it } from 'vitest';
import { shouldAutoSeedDemoData } from '../src/seed.js';

describe('shouldAutoSeedDemoData', () => {
  it('requires an explicit non-production opt-in', () => {
    expect(shouldAutoSeedDemoData({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldAutoSeedDemoData({ NODE_ENV: 'development', ERGDASH_SEED_DEMO: '1' })).toBe(true);
    expect(shouldAutoSeedDemoData({ NODE_ENV: 'production', ERGDASH_SEED_DEMO: '1' })).toBe(false);
  });
});
