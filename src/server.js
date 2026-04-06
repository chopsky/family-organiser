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
      console.log('ℹ WhatsApp not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER to enable');
    }

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
