/**
 * Coarse platform detection from a HTTP user-agent string.
 *
 * Returns 'ios' | 'android' | 'web' | null.
 *
 * NOTE: a Capacitor-wrapped iOS native app uses WKWebView with a user-agent
 * indistinguishable from Mobile Safari on the same device — both look like
 *   Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 ...) AppleWebKit/...
 * So "ios" here means "an iPhone-class device hit our API" - it does NOT
 * confirm the native app vs the browser. For that, cross-reference with
 * device_tokens (only the native app registers an APNs push token).
 *
 * iPad detection: modern iPads default to "Macintosh" UA via Safari's
 * "Request Desktop Website" mode (iPadOS 13+). We catch this via the
 * "(Macintosh; ... Mac OS X ...) ... Mobile" pattern + a Capacitor-
 * specific check, but the truly-desktop-mode iPad is indistinguishable
 * from a real Mac. Acceptable for the admin's purposes.
 */
function parsePlatformFromUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return null;

  // iOS device — iPhone, iPad, iPod (real ones, no desktop-mode iPad)
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';

  // Android phones / tablets
  if (/Android/i.test(ua)) return 'android';

  // Anything else that looks like a real browser → web
  if (/Mozilla|AppleWebKit|Chrome|Firefox|Safari|Edge/i.test(ua)) return 'web';

  // curl, scrapers, empty UA, unknown clients
  return null;
}

module.exports = { parsePlatformFromUserAgent };
