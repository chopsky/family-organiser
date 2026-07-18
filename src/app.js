const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Trust proxy (Railway runs behind a reverse proxy)
app.set('trust proxy', 1);

// CORS must come before helmet so preflight OPTIONS requests are handled
// correctly. Origin check lives in ./cors-origins so it can be unit-tested
// without booting the whole app (which requires Supabase env vars to load).
const { isAllowedOrigin } = require('./cors-origins');
const corsOptions = {
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    // Return false (not an Error) so the 'cors' package sends a response
    // without the Access-Control-Allow-Origin header rather than crashing
    // the request with a 500. The browser will still block it, but the
    // network tab shows a clean CORS rejection instead of an Express error.
    return cb(null, false);
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions)); // explicitly handle preflight for all routes

// Security headers (after CORS so helmet doesn't block preflight)
app.use(helmet({ crossOriginResourcePolicy: false }));

// ── Stripe webhook - MUST be mounted before express.json() ──────────
// Stripe signs the exact request body, so we can't let the global JSON
// parser touch it first (re-serialising changes the bytes → signature
// mismatch). The webhook router attaches its own express.raw() parser
// scoped just to its own routes. Mounting this early also places it
// BEFORE the /api rate limiter added below, which is correct - Stripe
// can burst retries and must never be throttled.
//
// Mounted at /api/webhooks/stripe (not /api/webhooks) so the raw-body
// parser applies ONLY to Stripe traffic. Other webhook routes mounted
// later (e.g. /api/webhooks/revenuecat) need normal JSON parsing and
// would break if the raw parser intercepted them.
app.use('/api/webhooks/stripe', require('./routes/stripe-webhook'));

// Body parsing - 10 MB to accommodate receipt images if sent as base64 (normally multer handles binary)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false })); // Twilio sends webhooks as URL-encoded form data

// Global rate limiter: 300 requests per minute per IP
if (process.env.NODE_ENV !== 'test') {
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
  });
  app.use('/api', limiter);

  // Stricter limiter for SENSITIVE auth endpoints - register, login, the
  // password-reset trio, and resend-verification. These are the real
  // brute-force / credential-stuffing surfaces, and Turnstile already
  // gates most of them; this is a backstop for distributed attempts that
  // somehow get past the bot challenge.
  //
  // We deliberately do NOT cover /api/auth as a whole. Silent endpoints
  // (refresh, me, sessions, logout, mark-onboarded) get called passively
  // - every tab-focus fires /refresh, every page load fires /me - so a
  // single user across a long browsing session can rack up dozens of
  // /api/auth calls without ever doing anything attack-worthy. Mixing
  // those in with the strict budget caused legitimate users to see
  // "Too many join attempts" mid-session. The global 300/min limiter
  // above still covers them as a sanity backstop.
  //
  // 50/hour/IP - generous enough that families on shared WiFi don't
  // collide, password-managers retrying don't trip, dev/QA testing has
  // headroom; tight enough that no realistic brute-force fits.
  const sensitiveAuthLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again in an hour.' },
  });
  app.use('/api/auth/register', sensitiveAuthLimiter);
  app.use('/api/auth/login', sensitiveAuthLimiter);
  app.use('/api/auth/forgot-password', sensitiveAuthLimiter);
  app.use('/api/auth/reset-password', sensitiveAuthLimiter);
  app.use('/api/auth/resend-verification', sensitiveAuthLimiter);
  // SSO sign-in endpoints are auth surfaces too - rate-limit them against
  // token-spraying / account-probing the same as password login.
  app.use('/api/auth/google', sensitiveAuthLimiter);
  app.use('/api/auth/apple', sensitiveAuthLimiter);

  // Stricter limiter for the public contact form (anti-spam)
  const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { error: 'Too many contact attempts. Please try again later.' },
  });
  app.use('/api/contact', contactLimiter);
}

// Health check. `commit` (Railway injects RAILWAY_GIT_COMMIT_SHA) lets us
// confirm which build is actually live - handy when verifying a deploy landed.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    // Booleans only (no secrets) so we can confirm feature flags actually
    // reached the running process without guessing at the Railway dashboard.
    flags: {
      calendarInbound: process.env.GOOGLE_CALENDAR_ENABLED === 'true',
      calendarWrites: process.env.GOOGLE_CALENDAR_WRITES_ENABLED === 'true',
      // Bot pipeline flags - exposed so "did the Railway flip actually
      // land?" is a curl, not a guess (the 2026-07-22 robotic-reply
      // report turned out to be exactly that question).
      botPipelineV2: process.env.BOT_PIPELINE === 'v2',
      botRouter: process.env.BOT_ROUTER === '1',
      botAgent: process.env.BOT_AGENT === '1',
      botVoice: process.env.BOT_VOICE === '1',
    },
  });
});

// LA term-dates directory - a self-contained, public web app (searchable list
// of every UK local education authority + its school term dates). The static
// page is served here; its read API is mounted below, BEFORE the subscription
// gate, because it's public and unauthenticated.
// The term-dates directory now lives at /school-term-dates (the SEO-facing
// name; served on the apex via a Vercel proxy). The SSR router goes FIRST -
// it server-renders the index list, per-council/per-school pages, and the
// sitemap - and falls through to the static bundle (app.js, fonts) for
// everything else. The old /la-term-dates path 301s so existing links and
// any indexed URLs carry over.
app.use('/school-term-dates', require('./routes/termDatesSsr'));
app.use('/school-term-dates', express.static(path.join(__dirname, '..', 'public', 'la-term-dates')));
app.use('/la-term-dates', (req, res) => res.redirect(301, `/school-term-dates${req.url === '/' ? '/' : req.url}`));

// Inbound webhooks (no auth - must be before authenticated routes)
app.use('/api/inbound-email', require('./routes/inbound-email'));

// RevenueCat webhook (Bearer-token auth, JSON body - safe to mount after
// the global JSON parser because RevenueCat doesn't sign body bytes).
// Must be reachable without an authenticated user session, so mount
// before the subscriptionStatus gate (handled by routing, not middleware
// here - webhooks live under /api/webhooks which is gate-excluded).
app.use('/api/webhooks/revenuecat', require('./routes/revenuecat-webhook'));

// Subscription endpoints - mounted BEFORE the gate so that expired users
// can still reach /status (to drive the frontend's subscribe modal) and,
// in later phases, /checkout and /portal. Defence-in-depth: the gate's
// own path exclusion list also covers /subscription.
app.use('/api/subscription', require('./routes/subscription'));

// Unsubscribe endpoint - no bearer auth (the URL's signed JWT is the
// credential). Mounted BEFORE the gate so expired users whose inbox
// still has a trial nudge email can click the link and reach it.
app.use('/api/unsubscribe', require('./routes/unsubscribe'));

// Contact form endpoint - public, no auth required.
app.use('/api/contact', require('./routes/contact'));

// LA term-dates directory API - public read endpoints (key-gated import).
// Mounted before the subscription gate: no household/auth context required.
app.use('/api/la-term-dates', require('./routes/laTermDates'));

// Trial / subscription gate. Returns 402 for households whose trial has
// expired or whose subscription has lapsed. Excludes /auth, /subscription,
// /admin, /inbound-email, /webhooks via an internal allowlist - see
// middleware/subscriptionStatus.js for the full decision table.
const { requireActiveSubscription } = require('./middleware/subscriptionStatus');
app.use('/api', requireActiveSubscription);

// API routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/household', require('./routes/household'));
app.use('/api/shopping', require('./routes/shopping'));
app.use('/api', require('./routes/shopping-lists'));
app.use('/api/tasks',    require('./routes/tasks'));
app.use('/api/chores',   require('./routes/chores'));
app.use('/api/rewards',  require('./routes/rewards'));
app.use('/api/kids',     require('./routes/kids'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/classify', require('./routes/classify'));
app.use('/api/receipt',  require('./routes/receipt'));
// Same router under the plural collection path: GET /api/receipts (list),
// GET /api/receipts/:id, PATCH .../items/:itemId (reconcile), DELETE. The
// singular /api/receipt keeps serving the scan POST for existing callers.
app.use('/api/receipts', require('./routes/receipt'));
app.use('/api/digest',   require('./routes/digest'));
app.use('/api/weather',  require('./routes/weather'));
app.use('/api/chat',     require('./routes/chat'));
app.use('/api/schools',  require('./routes/schools'));
app.use('/api',          require('./routes/meals'));
// /api/settings is mounted on the household router (PATCH /api/household/settings)
// but also available as PATCH /api/settings for convenience:
app.use('/api/settings', require('./routes/household'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/admin',    require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));

// 404 and error handlers are added in server.js AFTER the webhook route is registered

module.exports = app;
