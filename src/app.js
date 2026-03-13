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

// Global rate limiter: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/household', require('./routes/household'));
app.use('/api/shopping', require('./routes/shopping'));
app.use('/api/tasks',    require('./routes/tasks'));
app.use('/api/classify', require('./routes/classify'));
app.use('/api/receipt',  require('./routes/receipt'));
app.use('/api/digest',   require('./routes/digest'));
// /api/settings is mounted on the household router (PATCH /api/household/settings)
// but also available as PATCH /api/settings for convenience:
app.use('/api/settings', require('./routes/household'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Multer file-size errors
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size is 10 MB.' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field.' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
