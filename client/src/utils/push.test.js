import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PUSH_UNAVAILABLE_REASONS,
  disablePush,
  pushSupport,
  reconcilePushSubscription,
  urlBase64ToUint8Array,
} from './push.js';
import { api, setActiveProfileId } from '../api.js';

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

// Stands in for a browser that already holds a push subscription.
function stubSubscribedBrowser({ permission = 'granted' } = {}) {
  const subscription = {
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  // pushSupport() feature-detects against `window`, so Notification has to be
  // on it as well as on the global.
  vi.stubGlobal('window', {
    isSecureContext: true,
    PushManager: function PushManager() {},
    Notification: { permission },
  });
  vi.stubGlobal('navigator', {
    serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }) },
  });
  vi.stubGlobal('Notification', { permission });
  return subscription;
}

describe('reconcilePushSubscription', () => {
  it('claims the endpoint for a profile that has push enabled', async () => {
    stubSubscribedBrowser();
    const subscribe = vi.spyOn(api, 'subscribePush').mockResolvedValue({ subscribed: true });
    const unsubscribe = vi.spyOn(api, 'unsubscribePush').mockResolvedValue({ remaining: 1 });

    await reconcilePushSubscription(true);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  // A claim left behind by a profile that has push switched off keeps the
  // endpoint's reference count above zero, which stops the last genuinely
  // enabled profile from ever revoking the browser subscription.
  it('drops a stale claim for a profile that has push disabled', async () => {
    stubSubscribedBrowser();
    const subscribe = vi.spyOn(api, 'subscribePush').mockResolvedValue({ subscribed: true });
    const unsubscribe = vi.spyOn(api, 'unsubscribePush').mockResolvedValue({ remaining: 0 });

    await reconcilePushSubscription(false);

    expect(unsubscribe).toHaveBeenCalledWith('https://push.example/abc');
    expect(subscribe).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  // Reconciliation is bookkeeping, not the user asking to turn push off.
  it('never revokes the browser subscription', async () => {
    const subscription = stubSubscribedBrowser();
    vi.spyOn(api, 'unsubscribePush').mockResolvedValue({ remaining: 0 });

    await reconcilePushSubscription(false);

    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does nothing without notification permission', async () => {
    stubSubscribedBrowser({ permission: 'default' });
    const subscribe = vi.spyOn(api, 'subscribePush').mockResolvedValue({ subscribed: true });

    expect(await reconcilePushSubscription(true)).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('keeps a delayed reconciliation pinned to the profile that requested it', async () => {
    const subscription = stubSubscribedBrowser();
    let resolveSubscription;
    const delayedSubscription = new Promise(resolve => {
      resolveSubscription = resolve;
    });
    navigator.serviceWorker.getRegistration = async () => ({
      pushManager: { getSubscription: () => delayedSubscription },
    });

    let activeProfileId = '1';
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => activeProfileId),
      setItem: vi.fn((key, value) => {
        if (key === 'ergdash_profile') activeProfileId = String(value);
      }),
      removeItem: vi.fn(() => {
        activeProfileId = '';
      }),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ subscribed: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // Profile 1's feed response starts reconciliation, then profile 2 becomes
    // active before the browser finishes returning its subscription.
    const staleReconciliation = reconcilePushSubscription(true, 1);
    setActiveProfileId(2);
    resolveSubscription(subscription);
    await staleReconciliation;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers['X-Profile-Id']).toBe('1');
  });

  it('keeps a delayed stale-claim removal pinned to its original profile', async () => {
    const subscription = stubSubscribedBrowser();
    let resolveSubscription;
    const delayedSubscription = new Promise(resolve => {
      resolveSubscription = resolve;
    });
    navigator.serviceWorker.getRegistration = async () => ({
      pushManager: { getSubscription: () => delayedSubscription },
    });

    let activeProfileId = '1';
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => activeProfileId),
      setItem: vi.fn((key, value) => {
        if (key === 'ergdash_profile') activeProfileId = String(value);
      }),
      removeItem: vi.fn(() => {
        activeProfileId = '';
      }),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unsubscribed: true, remaining: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // Profile 1 had push disabled, but profile 2 becomes active before the
    // delayed browser lookup completes. The DELETE must still target profile 1.
    const staleReconciliation = reconcilePushSubscription(false, 1);
    setActiveProfileId(2);
    resolveSubscription(subscription);
    await staleReconciliation;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers['X-Profile-Id']).toBe('1');
  });
});

describe('disablePush', () => {
  it('revokes the browser subscription once no profile is using it', async () => {
    const subscription = stubSubscribedBrowser();
    vi.spyOn(api, 'unsubscribePush').mockResolvedValue({ remaining: 0 });

    await disablePush();

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  // Tearing the subscription down here is what previously broke push for the
  // other household member sharing the browser.
  it('leaves the browser subscription alone while another profile uses it', async () => {
    const subscription = stubSubscribedBrowser();
    vi.spyOn(api, 'unsubscribePush').mockResolvedValue({ remaining: 1 });

    await disablePush();

    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
