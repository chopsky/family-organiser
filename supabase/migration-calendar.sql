-- Calendar Feature Migration
-- Run this in the Supabase SQL editor

-- calendar_events — household calendar events with date+time support
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

create index if not exists idx_cal_events_household on calendar_events(household_id);
create index if not exists idx_cal_events_range on calendar_events(household_id, start_time, end_time);

-- calendar_feed_tokens — per-user secret tokens for .ics subscription URLs
create table if not exists calendar_feed_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  household_id  uuid not null references households(id) on delete cascade,
  token         text unique not null,
  created_at    timestamp with time zone default now()
);

create unique index if not exists idx_feed_tokens_user on calendar_feed_tokens(user_id, household_id);
create index if not exists idx_feed_tokens_token on calendar_feed_tokens(token);

-- calendar_connections — OAuth/CalDAV tokens for two-way sync
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

-- calendar_sync_mappings — maps Anora events to external calendar event IDs
create table if not exists calendar_sync_mappings (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references calendar_events(id) on delete cascade,
  connection_id     uuid not null references calendar_connections(id) on delete cascade,
  external_event_id text not null,
  external_etag     text,
  last_synced_at    timestamp with time zone default now(),
  unique(event_id, connection_id)
);
