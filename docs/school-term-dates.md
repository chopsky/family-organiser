# School term dates — how it works

How term dates (and closures) get into a school, where they're stored, and the
quirks worth knowing before you change anything. Term dates power the calendar's
"is it a school day?" logic, after-school activity reminders (which only fire in
term time), and the digest.

## Data model

Per-school dates live in **`school_term_dates`** (one row per dated entry):

| column          | notes                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| `school_id`     | FK to `household_schools`                                                    |
| `academic_year` | e.g. `"2025-2026"` (UK, Sept–Aug) or `"2026"` (SA, calendar year)           |
| `event_type`    | `term_start`, `term_end`, `half_term_start`, `half_term_end`, `inset_day`, `bank_holiday` |
| `date`          | `YYYY-MM-DD`                                                                 |
| `end_date`      | nullable; spans multi-day breaks/closures                                    |
| `label`         | human description                                                            |
| `source`        | how it got in: `manual`, `local_authority`, `website_scrape`, `ical_import` |

`household_schools` carries the rollup metadata: `term_dates_source` and
`term_dates_last_updated` (and `local_authority`, `school_urn`).

Persist helper: `addSchoolTermDates(schoolId, dates)` in `src/db/queries.js`.
It **whitelists** the columns above, so passing extra fields (e.g. the
extractor's `source_quote`) is harmless — they're dropped.

## The five ways dates get in

All import routes live in `src/routes/schools.js` and are admin-only
(`requireAuth, requireHousehold, requireAdmin`).

| Path | Route | When to use |
| ---- | ----- | ----------- |
| **Local authority** | `POST /:schoolId/import-la-dates` | LA-maintained schools — fetches the council's published dates |
| **School website / PDF URL** | `POST /:schoolId/import-website/preview` → `/confirm` | Schools that set their own dates (academies, faith, free schools) |
| **PDF upload** | `POST /:schoolId/import-pdf/preview` → `/confirm` | A term-dates PDF the user has on hand |
| **SA national calendar** | `POST /:schoolId/import-sa-term-dates` | South African schools (unified national calendar from 2026) |
| **Manual / iCal** | `POST /:schoolId/term-dates`, `POST /:schoolId/import-ical` | Hand entry, or a school iCal feed |
| **WhatsApp bot** | `src/bot/handlers.js` | User pastes/uploads a calendar in chat; uses the same extractor |

The preview→confirm pattern (website/PDF) is the safety net: the admin sees the
proposed dates, edits any that look wrong, then confirms. LA and SA import write
directly (LA now extracts from a real page, so it's trustworthy enough to skip
the preview; SA dates are an authoritative national source).

## Shared extractor + validator

Both the website/PDF imports, the WhatsApp bot, and the LA import funnel through
`src/services/term-date-extract.js`:

- **`fetchTermDatesPageText(url)`** — fetch a page or PDF and return plain text.
  SSRF-guarded (`assertFetchableUrl`: http(s) only, no credentials, no private
  IPs), handles both HTML (structure-preserving strip) and PDF (`pdf-parse`).
  Throws an `Error` with a user-facing message on any failure.
- **`extractTermDatesPreview({ pageText, country, currentAY, nextAY, ... })`** —
  runs the country-aware AI prompt (GB vs ZA vocab differ a lot), parses the
  lenient JSON, then runs `validateTermDates` (`src/services/termDateValidator.js`)
  which sanity-checks each date against its `source_quote`. Returns
  `{ ok, status, body: { dates, source_url, source_text_preview } }`.
- **`academicYearsForCountry(country)`** — current + next AY strings.

## The local-authority flow (the one that bit us)

**Route:** `POST /api/schools/:schoolId/import-la-dates`

### History
The original version asked the LLM to *recall* a council's dates — the prompt
said "if you're not certain of exact dates, use typical dates for that region" —
then saved that guess as authoritative `source='local_authority'` **and cached
it for every other family in the LA**. Result: confident, wrong dates (e.g.
Queen Elizabeth's Girls' came back with dates that didn't match Barnet's). Fixed
2026-06-25.

### How it works now (cache miss)
1. **`findOfficialTermDatesUrl({ localAuthority, academicYear })`**
   (`src/services/ai.js`) — Claude's `web_search` tool finds the council's OWN
   term-dates page (prefers `*.gov.uk`, accepts a direct PDF), returns a URL
   that actually appeared in results, or `null`.
2. **`fetchTermDatesPageText(url)`** — fetch that real page (SSRF-guarded).
3. **`extractTermDatesPreview(...)`** with `country: 'GB'` — the same validated
   extractor the website/PDF import uses.
4. Keep only this academic year's dates, persist, and **cache** the real result.

Every failure step returns a helpful message steering the admin to "Import from
school website", the PDF upload, or manual entry.

> LA-published dates are **advisory**. Many schools (academies, faith, free
> schools) set their own term dates that differ. That's why those schools should
> use the website/PDF/manual paths — the LA import is only correct for schools
> that follow their council's calendar.

### The shared cache

Table **`la_term_dates_cache`** (`supabase/migration-la-cache.sql`), keyed by
`(local_authority, academic_year)`, stores the extracted `dates` JSONB plus
`created_at`. It's shared across **all** families: Barnet's 2025-2026 dates are
the same for everyone, so the first import per LA pays the find+fetch+extract
cost and everyone after reads the copy. (The cost is higher than the old single
LLM-recall call, so the cache matters more now, not less.)

Helpers in `src/db/queries.js`:
- **`getCachedLATermDates(la, ay)`** — returns the cached dates **only if the row
  is younger than `LA_CACHE_MAX_AGE_DAYS` (90 days)**. An older row reads as a
  miss, so the route re-fetches and overwrites it. This is the backstop that
  flushes stale data (incl. any pre-fix rows) without a manual purge.
- **`cacheLATermDates(la, ay, dates)`** — upserts and **explicitly stamps
  `created_at = now()`** on every write. This is load-bearing: the column
  default only fires on INSERT, so an upsert-as-UPDATE would keep the old
  timestamp, making the row instantly stale and re-fetch on every import.

### Operating it
- **Force a fresh fetch** (bypass a possibly-wrong cached entry):
  `POST /:schoolId/import-la-dates?refresh=1` (or body `{ "refresh": true }`).
- **Purge poisoned pre-fix rows now:** run `supabase/migration-la-cache-purge.sql`
  in Supabase. It deletes rows with `created_at < '2026-06-25'`; safe to re-run.
  (The 90-day TTL would eventually flush them anyway; the purge just does it
  immediately.)

## Key files

| File | Role |
| ---- | ---- |
| `src/routes/schools.js` | All term-date routes (import, CRUD, preview/confirm) |
| `src/services/term-date-extract.js` | `fetchTermDatesPageText`, `extractTermDatesPreview`, `academicYearsForCountry` |
| `src/services/ai.js` | `findOfficialTermDatesUrl` (web search for the council page) |
| `src/services/termDateValidator.js` | `validateTermDates` (source-quote sanity check) |
| `src/db/queries.js` | `addSchoolTermDates`, `getCachedLATermDates`, `cacheLATermDates`, `LA_CACHE_MAX_AGE_DAYS` |
| `supabase/migration-la-cache.sql` | `la_term_dates_cache` table |
| `supabase/migration-la-cache-purge.sql` | one-time purge of pre-fix cached rows |
