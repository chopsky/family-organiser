/**
 * Apple Ads (AdServices) token redemption.
 *
 * The iOS app generates an attribution token on device
 * (AAAttribution.attributionToken()) and hands it to us; this module redeems
 * it against Apple's API to learn whether the install came from an Apple Ads
 * tap, and from which campaign. No auth is required on Apple's endpoint - the
 * token itself is the credential, valid for 24h from generation.
 *
 * Response semantics, per Apple's docs:
 *   200 -> attribution payload (campaignId, adGroupId, conversionType, ...)
 *   404 -> no attribution record. This means ORGANIC - except in the first
 *          minutes after install, when the record may simply not exist yet,
 *          which is why Apple recommends up to three attempts. Our call
 *          happens at first sign-in, usually minutes after install, so the
 *          retries are cheap insurance rather than the common path.
 *   400 -> invalid/expired token: report failure so the client can retry
 *          with a FRESH token on next launch, rather than recording organic.
 *   5xx -> Apple wobble: same treatment as 400.
 */

const APPLE_ADSERVICES_URL = 'https://api-adservices.apple.com/api/v1/';
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;
const TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Redeem a device attribution token with Apple.
 *
 * Returns:
 *   { ok: true, payload }            attributed - payload is Apple's response
 *   { ok: true, payload: { attribution: false } }   organic install
 *   { ok: false }                    could not get an answer (bad token /
 *                                    Apple down) - store NOTHING, let the
 *                                    client try again with a fresh token
 */
async function redeemAttributionToken(token, { fetchImpl = fetch } = {}) {
  if (!token || typeof token !== 'string' || token.length > 4096) return { ok: false };

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(APPLE_ADSERVICES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: token,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 200) {
        const payload = await res.json();
        return { ok: true, payload };
      }
      if (res.status === 404) {
        // Might be "too early" - retry; after the last attempt it's organic.
        if (attempt < ATTEMPTS) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return { ok: true, payload: { attribution: false } };
      }
      // 400 = bad token, anything else = Apple-side trouble. Either way we
      // have no answer worth persisting.
      console.warn(`[adservices] redemption returned ${res.status} (attempt ${attempt})`);
      return { ok: false };
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[adservices] redemption attempt ${attempt} failed: ${err.message}`);
      if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }
  return { ok: false };
}

module.exports = { redeemAttributionToken, APPLE_ADSERVICES_URL };
