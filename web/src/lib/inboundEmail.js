/**
 * The household forwarding address.
 *
 * One constant, because the domain was previously hardcoded in three
 * separate places in Settings alone - which is exactly how the displayed
 * address drifts from the one Postmark actually accepts.
 *
 * The BACKEND deliberately ignores the domain: the inbound webhook
 * matches on the local part only (routes/inbound-email.js), so mail to
 * any domain Postmark routes to us resolves to the right household.
 * Changing this constant changes what we SHOW; what we ACCEPT is
 * whatever has MX records pointing at Postmark.
 */
export const INBOUND_EMAIL_DOMAIN = 'inbox.housemait.com';

/** Full forwarding address for a household's alias or hex token. */
export function inboundEmailAddress(localPart) {
  return localPart ? `${localPart}@${INBOUND_EMAIL_DOMAIN}` : '';
}
