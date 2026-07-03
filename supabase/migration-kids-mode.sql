-- Kids mode (bright Fredoka skin for Child Mode): per-kid profile theme +
-- calendar flags for the "My Days" countdown and event icons.
--
-- users.kid_color   — one of the 8 Kids-mode colour preset keys (sky, coral,
--                     grape, sun, mint, teal, orange, berry). Kept separate
--                     from color_theme, which drives the parent-facing
--                     16-colour palette.
-- users.kid_avatar  — the kid's chosen avatar emoji (e.g. 🦖). Only surfaces
--                     in Kids mode.
-- calendar_events.kids_countdown — parent "pin as countdown" toggle; the
--                     nearest future pinned event becomes the countdown hero.
-- calendar_events.kids_emoji     — optional stored icon override; when null
--                     the client derives one from keywords/category.

alter table users add column if not exists kid_color text;
alter table users add column if not exists kid_avatar text;

alter table calendar_events add column if not exists kids_countdown boolean not null default false;
alter table calendar_events add column if not exists kids_emoji text;
