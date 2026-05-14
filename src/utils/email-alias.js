/**
 * Email-alias validation for the inbound webhook.
 *
 * Aliases form the user-facing local part of "<alias>@inbound.housemait.com".
 * They need to be safe for email systems and for humans to remember.
 *
 * Rules:
 *   • Lowercase a-z, digits 0-9, hyphens only. No dots / pluses / case
 *     differences — keeps matching trivial in the webhook (lower-case
 *     comparison) and the alias unambiguous to dictate over the phone.
 *   • 3-32 characters total. 3 because shorter is too easy to guess /
 *     squat. 32 because longer than that and you've lost the
 *     "memorable" reason for switching off the hex token.
 *   • Must start and end with an alphanumeric (no leading/trailing
 *     hyphen).
 *   • Cannot match any RESERVED slug — these are addresses that could
 *     conflict with system mail (postmaster, abuse, etc.) or with our
 *     own product surfaces (admin, support, …).
 */

const RESERVED_ALIASES = new Set([
  'admin', 'administrator', 'root',
  'support', 'help', 'helpdesk',
  'postmaster', 'mailer-daemon', 'no-reply', 'noreply', 'donotreply',
  'abuse', 'webmaster', 'hostmaster',
  'info', 'contact', 'feedback',
  'security', 'privacy', 'legal',
  'housemait', 'hello',
  'inbound', 'outbound',
  'test', 'demo', 'example',
  'api', 'app', 'www',
  'system', 'service',
]);

/**
 * @param {string} alias raw user input
 * @returns {{ ok: true, normalised: string } | { ok: false, reason: string }}
 */
function validateEmailAlias(alias) {
  if (typeof alias !== 'string') {
    return { ok: false, reason: 'Alias must be text.' };
  }
  const trimmed = alias.trim().toLowerCase();
  if (trimmed.length < 3) {
    return { ok: false, reason: 'Alias must be at least 3 characters.' };
  }
  if (trimmed.length > 32) {
    return { ok: false, reason: 'Alias must be 32 characters or fewer.' };
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
    return { ok: false, reason: 'Alias can only contain lowercase letters, numbers, and hyphens (no leading/trailing hyphen).' };
  }
  if (RESERVED_ALIASES.has(trimmed)) {
    return { ok: false, reason: 'That alias is reserved. Please choose another.' };
  }
  return { ok: true, normalised: trimmed };
}

function isReservedAlias(alias) {
  return RESERVED_ALIASES.has(String(alias || '').trim().toLowerCase());
}

module.exports = { validateEmailAlias, isReservedAlias, RESERVED_ALIASES };
