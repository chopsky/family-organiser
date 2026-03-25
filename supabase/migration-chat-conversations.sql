-- Chat conversations table
CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'New conversation',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id, updated_at DESC);

-- Add conversation_id to chat_messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE;

-- Migrate existing messages: create one "Previous messages" conversation per user who has messages
DO $$
DECLARE
  r RECORD;
  conv_id UUID;
BEGIN
  FOR r IN SELECT DISTINCT user_id, household_id FROM chat_messages WHERE conversation_id IS NULL
  LOOP
    INSERT INTO chat_conversations (household_id, user_id, title) VALUES (r.household_id, r.user_id, 'Previous messages') RETURNING id INTO conv_id;
    UPDATE chat_messages SET conversation_id = conv_id WHERE user_id = r.user_id AND conversation_id IS NULL;
  END LOOP;
END $$;

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at ASC);
