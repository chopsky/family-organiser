-- Migration: Add WhatsApp columns to users table
-- Run this in the Supabase SQL Editor
-- Telegram columns are kept for parallel operation

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS whatsapp_phone text,
  ADD COLUMN IF NOT EXISTS whatsapp_linked boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_whatsapp ON users(whatsapp_phone);

-- Verification codes table for WhatsApp phone linking
CREATE TABLE IF NOT EXISTS whatsapp_verification_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);
