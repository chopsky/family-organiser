require('dotenv').config();

const app = require('./app');
const { testConnection } = require('./db/client');
const { createBot } = require('./bot');
const { startScheduler } = require('./jobs/scheduler');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await testConnection();
    console.log('✓ Database connected');

    // Start Express API
    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`  Health check: http://localhost:${PORT}/health`);
    });

    // Start Telegram bot
    const token = process.env.TELEGRAM_TOKEN;
    if (!token || token === 'your_telegram_bot_token_here') {
      console.warn('⚠ TELEGRAM_TOKEN not set — bot not started');
    } else {
      const bot = createBot(token);
      const webhookUrl = process.env.WEBHOOK_URL;

      if (webhookUrl) {
        // Production: webhook mode.
        // Railway/Render expose the app at WEBHOOK_URL; Telegram POSTs updates to
        // /telegram/webhook.  We register the path with Telegram then handle it.
        const path = '/telegram/webhook';
        await bot.telegram.setWebhook(`${webhookUrl}${path}`);
        app.use(path, (req, res) => bot.handleUpdate(req.body, res));
        console.log(`✓ Telegram bot started (webhook: ${webhookUrl}${path})`);
      } else {
        // Development: long-polling (no public URL needed)
        await bot.telegram.deleteWebhook(); // clear any stale webhook
        bot.launch().then(() => console.log('✓ Telegram bot started (long-polling)'));
        // Graceful shutdown
        process.once('SIGINT',  () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
      }

      startScheduler(bot);
    }
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
