import { describe, expect, it } from 'vitest';
import { WEBHOOK_FORMATS, webhookFormat } from './webhookFormats.js';
// Reaches across into the server package on purpose: this is the one contract
// the two sides share, and a test is the right place to pin it. The module is
// pure and dependency-free, so importing it here costs nothing.
import { WEBHOOK_FORMATS as SERVER_FORMATS } from '../../../server/src/webhookFormats.js';

describe('webhook format copy', () => {
  // If these drift, the selector offers a format the server rejects, or hides
  // one it supports.
  it('offers exactly the formats the server accepts', () => {
    expect(WEBHOOK_FORMATS.map(format => format.id)).toEqual(SERVER_FORMATS);
  });

  it('gives every format the copy the settings page renders', () => {
    for (const format of WEBHOOK_FORMATS) {
      expect(format.label).toBeTruthy();
      expect(format.targets).toBeTruthy();
      expect(format.hint).toBeTruthy();
      expect(format.urlHint).toMatch(/^https:\/\//);
    }
  });

  // The URL hint is the placeholder in the settings input. It has to change
  // with the selector - showing an ntfy URL while Discord is selected is how
  // this was caught.
  it('gives each format a distinct URL hint', () => {
    const hints = WEBHOOK_FORMATS.map(format => format.urlHint);
    expect(new Set(hints).size).toBe(hints.length);
  });

  it('resolves a format by id and falls back rather than returning undefined', () => {
    expect(webhookFormat('discord').label).toBe('Discord');
    expect(webhookFormat('nonsense')).toBe(WEBHOOK_FORMATS[0]);
    expect(webhookFormat(undefined)).toBe(WEBHOOK_FORMATS[0]);
  });
});
