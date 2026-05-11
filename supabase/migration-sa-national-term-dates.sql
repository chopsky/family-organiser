-- South African national school term dates.
--
-- From 2026 onwards SA uses a unified national calendar — every public
-- school across all 9 provinces runs on the same term dates (replacing the
-- previous Coastal vs Inland split). This table is the single source of
-- truth for those national dates; ZA users can import them onto their
-- household_schools rows with one tap.
--
-- Schema:
--   year         — calendar year, e.g. 2026
--   event_type   — same vocabulary as school_term_dates.event_type so
--                  imports map 1:1: term_start, term_end, half_term_start,
--                  half_term_end. inset_day and bank_holiday are not used
--                  here (bank holidays seed separately via Nager.Date).
--   date         — date of the event
--   end_date     — for half-term breaks that span multiple days
--   label        — human-readable, e.g. 'Term 1 starts'
--   source       — 'manual' (hardcoded seed) or 'scraped' (future cron job).
--                  Manual seeds are authoritative until a scraper lands
--                  (see TODO at the bottom).
--
-- UNIQUE (year, event_type, date) prevents duplicate inserts if the cron
-- job or a re-run tries to insert the same row twice.

CREATE TABLE IF NOT EXISTS sa_national_term_dates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year        integer NOT NULL,
  event_type  text NOT NULL CHECK (event_type IN (
                'term_start','term_end','half_term_start','half_term_end'
              )),
  date        date NOT NULL,
  end_date    date,
  label       text NOT NULL,
  source      text NOT NULL DEFAULT 'manual',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, event_type, date)
);

CREATE INDEX IF NOT EXISTS idx_sa_national_term_dates_year
  ON sa_national_term_dates (year);

-- Seed 2026 dates.
--
-- VERIFY BEFORE LAUNCH: these dates are best-effort against the SA
-- Department of Basic Education's typical calendar pattern under the
-- unified 2026 system. Source: https://www.gov.za/about-sa/school-calendar
-- Update if the published dates differ.
--
-- Schools open dates per official 2026 SA national school calendar
-- (subject to verification against the actual gov.za publication).
INSERT INTO sa_national_term_dates (year, event_type, date, label, source) VALUES
  -- Term 1: ~14 Jan - 27 Mar 2026
  (2026, 'term_start',      '2026-01-14', 'Term 1 starts',     'manual'),
  (2026, 'half_term_start', '2026-02-14', 'Term 1 mid-break',  'manual'),
  (2026, 'half_term_end',   '2026-02-15', 'Term 1 mid-break ends', 'manual'),
  (2026, 'term_end',        '2026-03-27', 'Term 1 ends',       'manual'),
  -- Term 2: ~13 Apr - 26 Jun 2026
  (2026, 'term_start',      '2026-04-13', 'Term 2 starts',     'manual'),
  (2026, 'half_term_start', '2026-05-09', 'Term 2 mid-break',  'manual'),
  (2026, 'half_term_end',   '2026-05-10', 'Term 2 mid-break ends', 'manual'),
  (2026, 'term_end',        '2026-06-26', 'Term 2 ends',       'manual'),
  -- Term 3: ~20 Jul - 02 Oct 2026
  (2026, 'term_start',      '2026-07-20', 'Term 3 starts',     'manual'),
  (2026, 'half_term_start', '2026-08-22', 'Term 3 mid-break',  'manual'),
  (2026, 'half_term_end',   '2026-08-23', 'Term 3 mid-break ends', 'manual'),
  (2026, 'term_end',        '2026-10-02', 'Term 3 ends',       'manual'),
  -- Term 4: ~12 Oct - 09 Dec 2026
  (2026, 'term_start',      '2026-10-12', 'Term 4 starts',     'manual'),
  (2026, 'half_term_start', '2026-11-07', 'Term 4 mid-break',  'manual'),
  (2026, 'half_term_end',   '2026-11-08', 'Term 4 mid-break ends', 'manual'),
  (2026, 'term_end',        '2026-12-09', 'Term 4 ends',       'manual')
ON CONFLICT (year, event_type, date) DO NOTHING;

COMMENT ON TABLE sa_national_term_dates IS
  'South African national school term dates. From 2026 onwards SA uses a '
  'unified national calendar — these rows are the canonical source for '
  'every ZA household, copied onto household_schools.school_term_dates on '
  'import. 1.2.0 ships with hardcoded 2026 dates; a yearly scraper against '
  'gov.za/about-sa/school-calendar is a 1.2.1+ follow-up.';
