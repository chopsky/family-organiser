-- Remove Telegram integration
DROP TABLE IF EXISTS telegram_link_tokens;
DROP INDEX IF EXISTS idx_users_telegram;
ALTER TABLE users DROP COLUMN IF EXISTS telegram_chat_id;
ALTER TABLE users DROP COLUMN IF EXISTS telegram_username;
