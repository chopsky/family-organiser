-- Family Organiser Database Schema
-- Run this in the Supabase SQL editor to create all tables

-- Enable UUID extension (already enabled in Supabase by default)
create extension if not exists "pgcrypto";

-- households
create table if not exists households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  join_code    text unique not null,
  reminder_time time not null default '08:00:00',
  timezone     text not null default 'Africa/Johannesburg',
  created_at   timestamp with time zone default now()
);

-- users
create table if not exists users (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid references households(id) on delete cascade,
  name               text not null,
  email              text unique,
  password_hash      text,
  email_verified     boolean not null default false,
  telegram_chat_id   text,
  telegram_username  text,
  role               text not null default 'member' check (role in ('admin', 'member')),
  created_at         timestamp with time zone default now()
);

-- shopping_items
create table if not exists shopping_items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households(id) on delete cascade,
  item          text not null,
  category      text not null default 'other' check (category in ('groceries', 'clothing', 'household', 'school', 'pets', 'other')),
  quantity      text,
  added_by      uuid references users(id) on delete set null,
  completed     boolean not null default false,
  completed_at  timestamp with time zone,
  created_at    timestamp with time zone default now()
);

-- tasks
create table if not exists tasks (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid references households(id) on delete cascade,
  title             text not null,
  assigned_to       uuid references users(id) on delete set null,
  assigned_to_name  text,
  due_date          date not null default current_date,
  recurrence        text check (recurrence in ('daily', 'weekly', 'biweekly', 'monthly', 'yearly')),
  priority          text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  completed         boolean not null default false,
  completed_at      timestamp with time zone,
  added_by          uuid references users(id) on delete set null,
  created_at        timestamp with time zone default now()
);

-- invites
create table if not exists invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  email         text not null,
  token         text unique not null,
  invited_by    uuid not null references users(id) on delete cascade,
  accepted_at   timestamp with time zone,
  expires_at    timestamp with time zone not null,
  created_at    timestamp with time zone default now()
);

-- email_verification_tokens
create table if not exists email_verification_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token       text unique not null,
  used        boolean not null default false,
  expires_at  timestamp with time zone not null,
  created_at  timestamp with time zone default now()
);

-- password_reset_tokens
create table if not exists password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token       text unique not null,
  used        boolean not null default false,
  expires_at  timestamp with time zone not null,
  created_at  timestamp with time zone default now()
);

-- telegram_link_tokens
create table if not exists telegram_link_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token       text unique not null,
  used        boolean not null default false,
  expires_at  timestamp with time zone not null,
  created_at  timestamp with time zone default now()
);

-- calendar_events
create table if not exists calendar_events (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references households(id) on delete cascade,
  title            text not null,
  description      text,
  start_time       timestamp with time zone not null,
  end_time         timestamp with time zone not null,
  all_day          boolean not null default false,
  location         text,
  color            text not null default 'orange'
                     check (color in ('orange', 'blue', 'green', 'purple', 'red', 'gray')),
  recurrence       text check (recurrence in ('daily', 'weekly', 'biweekly', 'monthly', 'yearly')),
  assigned_to      uuid references users(id) on delete set null,
  assigned_to_name text,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamp with time zone default now()
);

-- calendar_feed_tokens
create table if not exists calendar_feed_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  household_id  uuid not null references households(id) on delete cascade,
  token         text unique not null,
  created_at    timestamp with time zone default now()
);

-- calendar_connections
create table if not exists calendar_connections (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  household_id         uuid not null references households(id) on delete cascade,
  provider             text not null check (provider in ('google', 'microsoft', 'apple')),
  access_token         text,
  refresh_token        text,
  token_expires_at     timestamp with time zone,
  external_calendar_id text,
  caldav_url           text,
  caldav_username      text,
  sync_enabled         boolean not null default true,
  created_at           timestamp with time zone default now(),
  unique(user_id, provider)
);

-- calendar_sync_mappings
create table if not exists calendar_sync_mappings (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references calendar_events(id) on delete cascade,
  connection_id     uuid not null references calendar_connections(id) on delete cascade,
  external_event_id text not null,
  external_etag     text,
  last_synced_at    timestamp with time zone default now(),
  unique(event_id, connection_id)
);

-- Indexes for common query patterns
create index if not exists idx_shopping_items_household on shopping_items(household_id);
create index if not exists idx_shopping_items_completed on shopping_items(household_id, completed);
create index if not exists idx_tasks_household on tasks(household_id);
create index if not exists idx_tasks_due_date on tasks(household_id, due_date, completed);
create index if not exists idx_users_household on users(household_id);
create index if not exists idx_users_telegram on users(telegram_chat_id);
create index if not exists idx_users_email on users(email);
create index if not exists idx_invites_token on invites(token);
create index if not exists idx_invites_email on invites(email);
create index if not exists idx_email_verification_tokens_token on email_verification_tokens(token);
create index if not exists idx_password_reset_tokens_token on password_reset_tokens(token);
create index if not exists idx_telegram_link_tokens_token on telegram_link_tokens(token);
create index if not exists idx_cal_events_household on calendar_events(household_id);
create index if not exists idx_cal_events_range on calendar_events(household_id, start_time, end_time);
create unique index if not exists idx_feed_tokens_user on calendar_feed_tokens(user_id, household_id);
create index if not exists idx_feed_tokens_token on calendar_feed_tokens(token);
