/**
 * Login-screen guard for social sign-in.
 *
 * The Google and Apple routes match a user by email and, when nothing
 * matches, create a fresh account. That is right on the SIGN-UP screen and
 * wrong on the LOGIN screen: the person believes they are returning, and a
 * silent new (empty) household reads as "my account is gone". Apple's
 * Hide-My-Email relay makes it the default outcome for an Apple tap on
 * the login screen (real support case, 2026-09-02).
 *
 * The client says which screen it is on via `intent`. A pending invite
 * still wins: a partner tapping "Continue with Apple" from the App Store
 * must keep auto-joining the household that invited them.
 *
 * Returns the refusal message when the sign-in must NOT create an account,
 * or null when the route may proceed as before.
 */

const PROVIDER_LABEL = { apple: 'Apple', google: 'Google' };

function socialLoginRefusal({ user, invite, intent, provider, email }) {
  if (user) return null;                 // existing account: normal login
  if (invite) return null;               // invitee: auto-join as before
  if (intent !== 'login') return null;   // sign-up screen: create as before

  const label = PROVIDER_LABEL[provider] || 'that';
  const hidden = provider === 'apple' && /@privaterelay\.appleid\.com$/i.test(String(email || ''));
  if (hidden) {
    return 'Apple hid your real email address, so it does not match a Housemait account. '
      + 'Sign in the way you signed up (Google or your email address), or create a new home.';
  }
  return `No Housemait account uses that ${label} email address. `
    + 'Sign in the way you signed up, or create a new home.';
}

module.exports = { socialLoginRefusal };
