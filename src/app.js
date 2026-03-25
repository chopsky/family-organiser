const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// CORS must come before helmet so preflight OPTIONS requests are handled correctly
const allowedOrigins = process.env.WEB_URL
  ? [process.env.WEB_URL]
  : true; // allow all in development
const corsOptions = { origin: allowedOrigins, credentials: true };
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions)); // explicitly handle preflight for all routes

// Security headers (after CORS so helmet doesn't block preflight)
app.use(helmet({ crossOriginResourcePolicy: false }));

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
app.use('/api/admin',    require('./routes/admin'));

// 404 and error handlers are added in server.js AFTER the webhook route is registered

module.exports = app;
