import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_FORMATS,
  buildWebhookRequest,
  webhookFormatDocs,
} from '../src/webhookFormats.js';

const notification = {
  kind: 'plan_reminder',
  title: "Today's session: 8 km",
  body: '4x2k / 5min rest',
  link: '/plan',
  created_at: '2026-07-26 07:00:00',
};

describe('json format', () => {
  it('sends ErgDash\'s own shape with title and message', () => {
    const { headers, body } = buildWebhookRequest('json', notification);

    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(body)).toMatchObject({
      title: "Today's session: 8 km",
      message: '4x2k / 5min rest',
      kind: 'plan_reminder',
      link: '/plan',
    });
  });

  it('is the fallback for an unrecognised format', () => {
    expect(buildWebhookRequest('nonsense', notification).body)
      .toBe(buildWebhookRequest('json', notification).body);
  });
});

describe('ntfy format', () => {
  // Posting to https://ntfy.sh/<topic> makes the raw body the message, so
  // sending JSON there would display the JSON. The title travels as a header.
  it('sends the message as a plain-text body, not JSON', () => {
    const { headers, body } = buildWebhookRequest('ntfy', notification);

    expect(headers['Content-Type']).toMatch(/text\/plain/);
    expect(body).toBe('4x2k / 5min rest');
    expect(() => JSON.parse(body)).toThrow();
  });

  it('puts the title and an icon tag in headers', () => {
    const { headers } = buildWebhookRequest('ntfy', notification);

    expect(headers['X-Title']).toBe("Today's session: 8 km");
    expect(headers['X-Tags']).toBe('calendar');
  });

  it('falls back to the title when there is no body', () => {
    const { body } = buildWebhookRequest('ntfy', { ...notification, body: null });
    expect(body).toBe("Today's session: 8 km");
  });

  // Header values are latin-1: an em dash in a title would throw on send.
  it('strips non-latin-1 characters from the title header', () => {
    const { headers } = buildWebhookRequest('ntfy', {
      ...notification,
      title: 'Session — 8 km ✅',
    });

    expect(headers['X-Title']).toBe('Session - 8 km -');
    expect(() => new Headers(headers)).not.toThrow();
  });

  it('adds a clickable link only when APP_ORIGIN is known', () => {
    expect(buildWebhookRequest('ntfy', notification).headers['X-Click']).toBeUndefined();
    expect(buildWebhookRequest('ntfy', notification, {
      appOrigin: 'https://ergdash.example.com',
    }).headers['X-Click']).toBe('https://ergdash.example.com/plan');
  });
});

describe('discord format', () => {
  it('uses the content field Discord actually renders', () => {
    const { body } = buildWebhookRequest('discord', notification);
    const parsed = JSON.parse(body);

    expect(parsed.content).toBe("**Today's session: 8 km**\n4x2k / 5min rest");
    expect(parsed.message).toBeUndefined();
  });

  it('truncates to Discord\'s 2000 character limit', () => {
    const { body } = buildWebhookRequest('discord', {
      ...notification,
      body: 'x'.repeat(4000),
    });

    expect(JSON.parse(body).content).toHaveLength(2000);
  });

  it('appends an absolute link when one is available', () => {
    const { body } = buildWebhookRequest('discord', notification, {
      appOrigin: 'https://ergdash.example.com',
    });

    expect(JSON.parse(body).content).toContain('https://ergdash.example.com/plan');
  });
});

describe('slack format', () => {
  it('uses the incoming-webhook text field', () => {
    const { body } = buildWebhookRequest('slack', notification);

    expect(JSON.parse(body).text).toBe("*Today's session: 8 km*\n4x2k / 5min rest");
  });
});

describe('webhookFormatDocs()', () => {
  it('documents every supported format', () => {
    expect(webhookFormatDocs().map(doc => doc.id)).toEqual(WEBHOOK_FORMATS);
  });

  // The whole point of generating the docs from the builder: a change to a
  // payload shape updates the in-app example automatically.
  it('generates each example with the real builder', () => {
    for (const doc of webhookFormatDocs()) {
      const built = buildWebhookRequest(doc.id, {
        kind: 'plan_reminder',
        title: "Today's session: 8 km",
        body: '4x2k / 5min rest',
        link: '/plan',
        created_at: '2026-07-26 07:00:00',
      });
      expect(doc.sample.body).toBe(built.body);
      expect(doc.sample.headers).toEqual(built.headers);
      expect(doc.sample.method).toBe('POST');
    }
  });

  it('gives every format a label, target list and URL hint', () => {
    for (const doc of webhookFormatDocs()) {
      expect(doc.label).toBeTruthy();
      expect(doc.targets).toBeTruthy();
      expect(doc.urlHint).toMatch(/^https:\/\//);
    }
  });
});
