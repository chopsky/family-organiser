# LA term-dates directory

A self-contained web app that imports the school term dates published by every
UK local **education** authority and presents them as a searchable, paginated,
A→Z list. It runs inside the main Housemait backend (reusing the proven
term-date extraction pipeline) but is otherwise standalone: its own tables, its
own page, its own monthly job.

> **Why 183, not 382?** The widely-quoted "382 local authorities" counts *all*
> UK principal councils. School term dates are set by **education** authorities:
> in two-tier areas the county sets them, not the ~180 district councils, and
> Scotland/NI run separate systems GIAS doesn't cover. GIAS lists **183**
> distinct education authorities (England + Wales) — every one a genuine
> term-date publisher. Using the GIAS names means the data lines up exactly with
> `household_schools.local_authority`, so Housemait can look records up with no
> mapping layer (the original goal in the dataset plan).

## What the user sees

`https://<api-host>/la-term-dates` — a page with:

- **Headline stats** (clickable to filter): total authorities, imported, need
  attention, not-yet-done, total dates stored, and when the last full import ran.
- **Search** (debounced) + **region** filter (England/Wales).
- **A→Z paginated list**. Each authority shows its status badge; expanding a row
  loads its dates grouped by academic year.
- **The remedy list**: the "Need attention" filter shows every authority we
  couldn't fully import, each with the *reason* (`import_error`) so it can be
  fixed. With `?key=<LA_IMPORT_KEY>` in the URL the page enters **admin mode** and
  each row gets a **Re-import** button.

## Data model (`supabase/migration-la-term-dates-directory.sql`)

| Table | Role |
| ----- | ---- |
| `la_directory` | One row per authority (GIAS `LA (name)`), plus per-LA import state: `import_status` (`pending`/`ok`/`partial`/`failed`), `import_error`, `source_url`, `date_count`, `last_imported_at`, `last_attempted_at`. |
| `la_term_date_entries` | One row per dated entry (`event_type`, `date`, `end_date`, `label`), FK → `la_directory`. Same shape as `school_term_dates`. |
| `la_import_runs` | One row per import run (cron or manual) with tallies — operational visibility. |

RLS is on with **no** anon/user policies: only the backend (service-role key)
touches these tables. This is distinct from `la_term_dates_cache`, which is the
per-family Housemait import cache — see `docs/school-term-dates.md`.

## How an import works (per authority)

**Two-tier** (`src/services/laTermDatesImport.js`), because a large share of
councils sit behind a WAF (Incapsula/Imperva, Cloudflare) that 403s a direct
bot fetch or returns a 200 challenge page — but allowlists search-engine
crawlers, so the dates are still reachable through search.

1. **Find the page** — `findOfficialTermDatesUrl` (Claude `web_search`) returns
   the council's *own* term-dates URL (prefers `*.gov.uk`). Kept as provenance
   even if the fetch is later blocked.
2. **Direct** (`import_method = 'direct'`, most trustworthy) —
   `fetchTermDatesPageText(url)` (SSRF-guarded, full real-Chrome header set,
   WAF-challenge detection) → `extractTermDatesPreview({ country: 'GB' })`, the
   validated extractor. If it yields dates, we're done.
3. **Search fallback** (`import_method = 'search'`) — only if the direct path is
   blocked or empty: `extractTermDatesViaSearch` (`src/services/ai.js`) uses
   `web_search` to extract dates **from the retrieved results**, each with a
   verbatim `source_quote`, then runs the same `validateTermDates` pass. This is
   grounded retrieval, *not* model-memory recall (the prompt forbids "typical"
   dates and returns `[]` if the search surfaces nothing concrete).

Measured on a sample, this lifts the success rate from ~50% (direct only) to
~85-90%. The genuinely-hard councils (no single LA-wide calendar, dates only in
an un-indexed PDF) still return nothing and land in "Need attention" — by
design, not by guessing.

Outcome, recorded on the LA's row:

| Status | Meaning |
| ------ | ------- |
| `ok` | Current academic-year dates imported. (Next year missing is normal and stays `ok` — councils often publish it later.) |
| `partial` | Some dates found, but **none for the current year** — worth a look. |
| `failed` | Nothing usable. `import_error` says why (no page found / page 403'd / JS-rendered page with no extractable dates / …) so you can remedy it. |

Persistence is delete-then-insert per `(la, academic_year)`, so re-running is
idempotent. One bad council can never derail a batch — `importAuthority` always
resolves.

## The monthly import

`src/jobs/la-term-dates-import.js` → wired in `src/jobs/scheduler.js`:

```
cron.schedule('0 3 1 * *', () => runMonthlyLAImport());  // 1st of month, 03:00 UTC
```

It re-imports **every** authority (picks up newly-published years, retries past
failures). A per-month scheduler lock (`la_term_dates_import` + `YYYY-MM-01`)
makes it safe across rolling deploys. Concurrency is capped at 3 — polite to
councils and friendly to AI rate limits. A full run is ~183 authorities and
takes roughly 15–30 minutes.

## First-time setup

1. **Apply the migration** — run `supabase/migration-la-term-dates-directory.sql`
   in the Supabase SQL editor. (If you applied an earlier copy before the
   `import_method` column existed, also run the incremental
   `supabase/migration-la-import-method.sql` — one `ALTER`. The code self-heals
   if you skip it: status is still recorded, you just lose the direct/search
   provenance tag.)
2. **Seed the authorities** from the bundled GIAS CSV:
   ```bash
   node scripts/seed-la-directory.js
   ```
   (Idempotent; re-run after a fresh GIAS download to refresh school counts.)
3. **Set the operator key** so imports can be triggered:
   ```bash
   # Railway / .env
   LA_IMPORT_KEY=<a long random string>
   ```
4. **Kick off the first import** (don't wait a month):
   ```bash
   curl -X POST https://<api-host>/api/la-term-dates/import \
        -H "x-import-key: $LA_IMPORT_KEY"
   ```
   Or one authority: `-d '{"slug":"barnet"}' -H "Content-Type: application/json"`.

## API

| Method | Route | Notes |
| ------ | ----- | ----- |
| GET | `/api/la-term-dates/stats` | counts + last run |
| GET | `/api/la-term-dates/authorities?search=&status=&region=&page=&pageSize=` | A→Z, paginated. `status=attention` = failed∪partial |
| GET | `/api/la-term-dates/authorities/:slug` | one authority + dates grouped by year |
| GET | `/api/la-term-dates/failures` | the remedy list |
| POST | `/api/la-term-dates/import` | **key-gated** (`x-import-key`). Body `{slug}` = one (sync); empty = full run (async); `{onlyPending}` / `{onlyStale}` to scope |

## Key files

| File | Role |
| ---- | ---- |
| `supabase/migration-la-term-dates-directory.sql` | tables |
| `supabase/migration-la-import-method.sql` | incremental: `import_method` column |
| `scripts/seed-la-directory.js` | seed 183 LAs from GIAS |
| `scripts/run-la-import.js` | run the import from the CLI (no server/curl) |
| `src/db/laTermDates.js` | data access (list/search/stats/persist) |
| `src/services/laTermDatesImport.js` | the importer (per-LA + batch) |
| `src/services/laTermDatesImport.test.js` | outcome-classification tests |
| `src/jobs/la-term-dates-import.js` | monthly job wrapper |
| `src/routes/laTermDates.js` | the API |
| `public/la-term-dates/index.html` | the web app (self-contained) |

## Cost controls

The dominant cost is the Claude **`web_search`** tool — both its per-search fee
and, mainly, the result-page content it injects back as input tokens. A full
unguarded run of all 183 cost ~$30. The importer keeps that down with:

- **Haiku, not Sonnet, for the two search steps** (`findOfficialTermDatesUrl`,
  `extractTermDatesViaSearch` in `ai.js`) — ~¼ the per-token rate on the
  injected search content. `validateTermDates` still guards quality.
- **`max_uses` on the `web_search` tool** (3 for URL-find, 4 for the search
  fallback) so one call can't run away doing many searches.
- **URL caching** — `importAuthority` reuses the stored `source_url` and skips
  `findOfficialTermDatesUrl` entirely on re-runs (a stale URL just falls through
  to the search path). Removes one `web_search` per known authority per run.
- **Attempt cap** — after `MAX_IMPORT_ATTEMPTS` (3) failures a council is no
  longer auto-retried by `--stale` / the monthly cron (it stays in "Need
  attention" and can be retried explicitly by slug). Stops re-paying for
  structurally-impossible councils. Needs `migration-la-import-attempts.sql`;
  the code self-heals if it isn't applied yet (just doesn't cap until it is).
- **Monthly cron runs `onlyStale`**, not a full re-sweep of all 183.

To retry one council past the cap: `node scripts/run-la-import.js <slug>`.

## Relationship to Housemait

Housemait's "Import from local authority" (`POST /:schoolId/import-la-dates` in
`src/routes/schools.js`) now reads this directory **first**, via
`laDb.getDirectoryTermDatesByName(local_authority, academicYear)` — a plain DB
lookup keyed by name (the directory's `name` matches
`household_schools.local_authority`, both GIAS LA strings). A directory hit is
free and instant and never touches the paid `web_search` path.

The live web-search-and-scrape remains the **fallback**, used only when the LA
isn't in the directory yet (or on `?refresh=1`), so the feature still works for
the long tail while the dataset fills in. As more authorities import `ok`, more
families get served straight from the directory. See the
`project-la-term-dates-dataset` memory.
