-- Migration: Add due_time, description, notification, notification_sent_at to tasks
-- Run this in the Supabase SQL Editor

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS due_time time,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS notification text CHECK (notification IN (
    'at_time', '5_min', '15_min', '30_min', '1_hour', '2_hours', '1_day', '2_days'
  )),
  ADD COLUMN IF NOT EXISTS notification_sent_at timestamp with time zone;
