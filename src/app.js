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

// ── Stripe webhook — MUST be mounted before express.json() ──────────
// Stripe signs the exact request body, so we can't let the global JSON
// parser touch it first (re-serialising changes the bytes → signature
// mismatch). The webhook router attaches its own express.raw() parser
// scoped just to its own routes. Mounting this early also places it
// BEFORE the /api rate limiter added below, which is correct — Stripe
// can burst retries and must never be throttled.
app.use('/api/webhooks', require('./routes/stripe-webhook'));

// Body parsing — 10 MB to accommodate receipt images if sent as base64 (normally multer handles binary)
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

  // Stricter limiter for auth endpoint (prevent brute-force on join codes)
  const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    message: { error: 'Too many join attempts. Please try again in an hour.' },
  });
  app.use('/api/auth', authLimiter);
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Inbound webhooks (no auth — must be before authenticated routes)
app.use('/api/inbound-email', require('./routes/inbound-email'));

// Subscription endpoints — mounted BEFORE the gate so that expired users
// can still reach /status (to drive the frontend's subscribe modal) and,
// in later phases, /checkout and /portal. Defence-in-depth: the gate's
// own path exclusion list also covers /subscription.
app.use('/api/subscription', require('./routes/subscription'));

// Unsubscribe endpoint — no bearer auth (the URL's signed JWT is the
// credential). Mounted BEFORE the gate so expired users whose inbox
// still has a trial nudge email can click the link and reach it.
app.use('/api/unsubscribe', require('./routes/unsubscribe'));

// Trial / subscription gate. Returns 402 for households whose trial has
// expired or whose subscription has lapsed. Excludes /auth, /subscription,
// /admin, /inbound-email, /webhooks via an internal allowlist — see
// middleware/subscriptionStatus.js for the full decision table.
const { requireActiveSubscription } = require('./middleware/subscriptionStatus');
app.use('/api', requireActiveSubscription);

// API routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/household', require('./routes/household'));
app.use('/api/shopping', require('./routes/shopping'));
app.use('/api', require('./routes/shopping-lists'));
app.use('/api/tasks',    require('./routes/tasks'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/classify', require('./routes/classify'));
app.use('/api/receipt',  require('./routes/receipt'));
app.use('/api/digest',   require('./routes/digest'));
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
