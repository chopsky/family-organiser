require('dotenv').config();

const { checkEnv } = require('./utils/check-env');
checkEnv(); // Fail fast if required env vars are missing

const app = require('./app');
const { testConnection } = require('./db/client');
const { startScheduler } = require('./jobs/scheduler');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await testConnection();
    console.log('✓ Database connected');

    // Mount WhatsApp webhook route (before 404 handler)
    const whatsappRouter = require('./routes/whatsapp');
    app.use('/whatsapp', whatsappRouter);
    const whatsappService = require('./services/whatsapp');
    if (whatsappService.isConfigured()) {
      console.log('✓ WhatsApp (Twilio) configured');
    } else {
      console.log('ℹ WhatsApp not configured - set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER to enable');
    }

    // Diagnostic startup log: confirm which WhatsApp Content Templates
    // are actually visible to this process. Useful for catching cases
    // where the env var is set in Railway's Variables tab but the
    // running container doesn't see it (env-var propagation lag,
    // typo in the variable NAME, wrong environment, etc.). Logs only
    // the boolean + the first 8 chars of the SID - never the full
    // value (these aren't secrets but no reason to surface them in
    // every deploy log line).
    const _shortSid = (v) => (typeof v === 'string' && v.trim().length > 0 ? `${v.trim().slice(0, 8)}…(len ${v.length})` : 'NOT SET');
    console.log(`  TWILIO_TEMPLATE_DAILY_REMINDER:    ${_shortSid(process.env.TWILIO_TEMPLATE_DAILY_REMINDER)}`);
    console.log(`  TWILIO_TEMPLATE_HOUSEHOLD_UPDATE:  ${_shortSid(process.env.TWILIO_TEMPLATE_HOUSEHOLD_UPDATE)}`);
    console.log(`  TWILIO_MESSAGING_SERVICE_SID:      ${_shortSid(process.env.TWILIO_MESSAGING_SERVICE_SID)}`);

    // Start Express API
    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`  Health check: http://localhost:${PORT}/health`);
    });

    startScheduler();

    // Add 404 and error handlers AFTER webhook route so they don't intercept it
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
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
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
