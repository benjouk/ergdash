import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUSH_UNAVAILABLE_REASONS, pushSupport, urlBase64ToUint8Array } from './push.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Stand-ins for the three browser capabilities pushSupport() checks.
function stubBrowser({ secure = true, serviceWorker = true, permission = 'default' } = {}) {
  const window = { isSecureContext: secure, PushManager: function PushManager() {} };
  if (permission !== null) window.Notification = { permission };
  vi.stubGlobal('window', window);
  vi.stubGlobal('navigator', serviceWorker ? { serviceWorker: {} } : {});
  vi.stubGlobal('Notification', permission === null ? undefined : { permission });
}

describe('pushSupport', () => {
  it('reports support on a secure origin with the APIs present', () => {
    stubBrowser();
    expect(pushSupport()).toEqual({ supported: true, reason: null });
  });

  // ErgDash deliberately supports plain-HTTP LAN access, where browsers refuse
  // to register a service worker at all. That has to read as an explained
  // limitation, never as a button that does nothing.
  it('refuses on an insecure origin and explains why', () => {
    stubBrowser({ secure: false });
    const support = pushSupport();
    expect(support).toEqual({ supported: false, reason: 'insecure' });
    expect(PUSH_UNAVAILABLE_REASONS[support.reason]).toMatch(/HTTPS or on localhost/);
  });

  it('refuses when the browser lacks a service worker', () => {
    stubBrowser({ serviceWorker: false });
    expect(pushSupport().reason).toBe('unsupported');
  });

  it('refuses when the user has already blocked notifications', () => {
    stubBrowser({ permission: 'denied' });
    expect(pushSupport().reason).toBe('denied');
  });

  it('has a message for every reason it can return', () => {
    for (const reason of ['demo', 'insecure', 'unsupported', 'denied']) {
      expect(PUSH_UNAVAILABLE_REASONS[reason]).toBeTruthy();
    }
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes an unpadded base64url key to raw bytes', () => {
    // "Hello" is SGVsbG8= in standard base64; VAPID keys arrive unpadded.
    expect([...urlBase64ToUint8Array('SGVsbG8')]).toEqual([72, 101, 108, 108, 111]);
  });

  it('decodes the base64url alphabet', () => {
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]);
  });
});
