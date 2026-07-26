import { api } from '../api.js';

// Why push might not be on offer. The Settings page shows these verbatim
// rather than a dead button, because "nothing happened" is the worst possible
// answer to "enable notifications".
export const PUSH_UNAVAILABLE_REASONS = {
  demo: 'Push is unavailable in the demo. Run ErgDash self-hosted to use it.',
  insecure:
    'Push needs a secure connection. Browsers only allow it over HTTPS or on '
    + 'localhost, so a plain-HTTP LAN address cannot use it — the in-app centre '
    + 'and webhooks still work.',
  unsupported: 'This browser does not support push notifications.',
  denied:
    'Notifications are blocked for this site. Allow them in your browser’s site '
    + 'settings, then try again.',
};

export function pushSupport() {
  if (import.meta.env.VITE_DEMO === '1') return { supported: false, reason: 'demo' };
  if (typeof window === 'undefined') return { supported: false, reason: 'unsupported' };
  // isSecureContext is exactly the condition the browser itself applies to
  // service worker registration, so it is the honest thing to test.
  if (!window.isSecureContext) return { supported: false, reason: 'insecure' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { supported: false, reason: 'unsupported' };
  }
  if (Notification.permission === 'denied') return { supported: false, reason: 'denied' };
  return { supported: true, reason: null };
}

// The VAPID public key arrives base64url-encoded; PushManager wants the raw
// bytes.
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function getExistingSubscription() {
  if (!pushSupport().supported) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

// Prompts for permission if needed, subscribes, and registers the subscription
// with the server. Throws with a message fit to show the user.
export async function enablePush() {
  const support = pushSupport();
  if (!support.supported) throw new Error(PUSH_UNAVAILABLE_REASONS[support.reason]);

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(PUSH_UNAVAILABLE_REASONS.denied);

  const registration = await navigator.serviceWorker.ready;
  const { public_key: publicKey } = await api.getVapidKey();
  if (!publicKey) throw new Error('The server did not return a push key.');

  // An existing subscription is reused: re-subscribing with the same key is a
  // no-op, and the server upserts on endpoint so a profile switch moves it.
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

  await api.subscribePush(subscription.toJSON());
  return subscription;
}

// Gives up only the active profile's claim on this browser. The browser-side
// PushSubscription is revoked only once no profile is using it: on a shared
// household browser, tearing it down while another member still relies on it
// would silently break their push too.
export async function disablePush() {
  const subscription = await getExistingSubscription();
  if (!subscription) return false;

  const { remaining } = await api.unsubscribePush(subscription.endpoint);
  if (!remaining) await subscription.unsubscribe();
  return true;
}

// Re-registers this browser's existing subscription against whichever profile
// is now active. Switching profiles does not create a new browser
// subscription, so without this the newly active profile would show push as
// enabled while having no row to deliver to.
export async function reconcilePushSubscription() {
  if (!pushSupport().supported || Notification.permission !== 'granted') return false;

  const subscription = await getExistingSubscription();
  if (!subscription) return false;

  await api.subscribePush(subscription.toJSON());
  return true;
}
