import { getDb } from '../db.js';

// Resolves the active profile for API requests. The client sends its
// selection as X-Profile-Id; requests without one (older clients, curl)
// fall back to the first profile so upgraded single-user installs keep
// working. profile_id — never workouts.user_id — is the authorization
// boundary for every scoped query downstream.
export function resolveProfile(req, res, next) {
  const db = getDb();
  const requested = Number(req.get('x-profile-id'));
  // A missing OR unknown/stale id (e.g. a client whose saved profile was
  // deleted on another device) falls back to the first profile rather than
  // erroring; only a genuinely profile-less DB is a 409.
  let profile = Number.isInteger(requested) && requested > 0
    ? db.prepare('SELECT id FROM profiles WHERE id = ?').get(requested)
    : null;
  if (!profile) profile = db.prepare('SELECT id FROM profiles ORDER BY id LIMIT 1').get();
  if (!profile) {
    return res.status(409).json({ error: 'No profiles exist yet. Connect a Concept2 account via /auth/login.' });
  }
  req.profileId = profile.id;
  next();
}
