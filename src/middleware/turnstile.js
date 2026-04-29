/**
 * Cloudflare Turnstile validation middleware.
 *
 * Bots hitting /register, /login, /forgot-password, /contact are the main
 * abuse surface — fake accounts burning trial slots, credential stuffing,
 * email bombing via password resets, contact-form spam. The 20/hour auth
 * rate limiter (see app.js) is a strong baseline but doesn't stop a bot
 * rotating residential proxies. Turnstile is the second layer.
 *
 * Setup:
 *   1. Cloudflare dashboard → Turnstile → Add site → get site_key + secret_key
 *   2. Set TURNSTILE_SECRET_KEY in the API env (Railway)
 *   3. Set VITE_TURNSTILE_SITE_KEY in the web env
 *
 * Behaviour:
 *   - If TURNSTILE_SECRET_KEY is unset, middleware fail-opens with a one-time
 *     warning. Lets local dev work without Cloudflare creds, and gives a
 *     graceful rollout path before iOS app v1.0.0(4) ships with the widget.
 *   - In NODE_ENV=test the middleware is a no-op so existing test suites pass.
 *   - When the env var IS set, missing or invalid tokens return 403.
 *
 * Token contract: client sends `turnstile_token` in the JSON body. Helper
 * widget at web/src/components/TurnstileWidget.jsx provides this.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
let warnedNoSecret = false;

async function requireTurnstile(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (!warnedNoSecret) {
      console.warn(
        '[turnstile] TURNSTILE_SECRET_KEY not set — bot protection is OFF for ' +
        'register/login/forgot-password/contact. Set it in Railway env to enable.'
      );
      warnedNoSecret = true;
    }
    return next();
  }

  const token = req.body?.turnstile_token;
  if (!token) {
    return res.status(403).json({
      error: 'Missing bot verification. Refresh the page and try again.',
    });
  }

  try {
    const params = new URLSearchParams();
    params.set('secret', secret);
    params.set('response', token);
    // remoteip is optional but improves accuracy. Express's req.ip respects
    // the X-Forwarded-For header through Railway's proxy because we trust
    // proxies in app.js.
    if (req.ip) params.set('remoteip', req.ip);

    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await r.json();

    if (!data.success) {
      console.warn(
        `[turnstile] Verification failed for ${req.path}:`,
        (data['error-codes'] || []).join(',') || 'unknown'
      );
      return res.status(403).json({
        error: 'Bot verification failed. Please refresh and try again.',
      });
    }

    return next();
  } catch (err) {
    // Network blip talking to Cloudflare. Fail-open rather than locking
    // legitimate users out — abuse is constrained by the rate limiter
    // anyway, and Cloudflare outages are very rare.
    console.error('[turnstile] siteverify call failed:', err.message);
    return next();
  }
}

module.exports = { requireTurnstile };
