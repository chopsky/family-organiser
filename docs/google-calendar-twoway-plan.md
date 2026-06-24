# Google Calendar two‑way sync — implementation plan

Status: **proposed** · Owner: founder · Last updated: 2026‑06‑24

## 1. Decision & context

Re‑introduce Google Calendar sync as a **safe two‑way** integration:

- **Inbound (Google → Housemait):** OAuth **read‑only** pull of the user's selected calendars.
- **Outbound (Housemait → Google):** writes go **only** into a dedicated **"Housemait" secondary calendar** that the app creates, using the **`calendar.app.created`** scope — which by Google's own enforcement **cannot touch the user's primary or any other calendar**.

This directly neutralises the two reasons two‑way was removed last time:

| Original failure mode | Why it happened | Fix in this design |
|---|---|---|
| Housemait changed event **times** in the user's calendar | naive local times written without an explicit IANA tz → Google reinterpreted them | **Timezone discipline** (every write carries an explicit IANA `timeZone`) + DST round‑trip tests; and even a tz bug is now contained to the Housemait calendar |
| Fear that a Housemait bug could **erase users' real calendar data** | broad read/write scope writing into the **primary** calendar | **`calendar.app.created` scope** → app has **no permission** to read/modify/delete the user's other calendars. Worst‑case blast radius = the Housemait calendar, fully reconstructable from our DB |

Scope: Google only for now. **Apple/iCloud stays on read‑only ICS** (no good OAuth; we will **not** use CalDAV app‑specific passwords). **Outlook** is a later phase via Microsoft Graph using the identical model.

Reuse: the inbound render/dedup/cleanup/visibility pipeline already exists (`external_calendar_feeds` + `calendar_events.external_feed_id`); the old (dropped) `calendar_connections` / `calendar_sync_mappings` schema is in git history to crib from.

---

## 2. Hard requirements (safety invariants — non‑negotiable)

These are gating. No outbound write ships until every one is implemented **and** covered by a green test.

1. **Two‑scope split.** Request only `calendar.readonly` (inbound) + `calendar.app.created` (outbound). **Never** request `calendar.events` or `calendar` (broad write). Scopes are requested **incrementally** on "Connect Google Calendar", never bundled into sign‑in. Offline access (`access_type=offline`, `prompt=consent`) for a refresh token.
2. **Single writable target.** Each connection stores exactly **one** writable `app_calendar_id` (the Housemait secondary calendar). Every outbound API call asserts its target `calendarId === app_calendar_id`. The code never stores or writes any other calendarId.
3. **Mapping‑only deletes.** Only delete a Google event that exists in `calendar_sync_mappings` (i.e. Housemait created it). **Never** "delete everything not in Housemait" / delete‑by‑absence.
4. **Circuit breaker.** A sync/reconcile run that would delete more than `MAX_DELETES_PER_RUN` (default 5) **or** more than `MAX_DELETE_PCT` (default 20%) of the Housemait calendar **aborts and alerts, executing nothing**.
5. **Global kill switch.** `GOOGLE_CAL_WRITES_ENABLED` (env) + a DB flag instantly disable **all** outbound writes. Inbound pull keeps working.
6. **Write audit log.** Every outbound create/update/delete is logged (connection, calendarId, google_event_id, op, housemait_event_id, result, error). Anomaly alerting on delete spikes.
7. **Timezone discipline.** Every timed write sends `{ dateTime, timeZone: <IANA> }`; all‑day sends `{ date }`. Source tz stored and round‑tripped. DST‑boundary round‑trip tests required.
8. **Echo guard / idempotency.** An event sourced **from** Google (inbound) must never be pushed back outbound. Events are source‑tagged; only **household‑native** events sync out. Writes are idempotent (keyed by mapping).
9. **Token security.** Refresh tokens encrypted at rest; never logged. Table RLS server‑only (mirror `external_calendar_feeds`). Graceful handling of revoked/expired tokens (mark connection `needs_reconnect`, surface re‑connect).
10. **Staged rollout.** Outbound is gated behind a per‑household flag; internal + a handful of households first, watching the audit log and breaker before widening.

---

## 3. Architecture

```
Google account
 ├─ user's real calendars ──(calendar.readonly, READ ONLY)──▶  Housemait   [inbound]
 └─ "Housemait" calendar   ◀─(calendar.app.created, WRITE)──   Housemait   [outbound]
       (created & owned by the app; the app can touch nothing else)
```

- **Inbound:** per‑connection cron pull on the existing external‑feed cadence. For each **selected** calendar, list events (incremental `syncToken`), upsert into `calendar_events`. These are **read‑only in Housemait** (same as ICS feeds — you can't edit a Google‑owned event in our UI).
- **Outbound:** event‑driven. When a **household‑native** event is created/updated/deleted in Housemait, enqueue a write to `app_calendar_id`; record the mapping + audit. A periodic **reconciliation sweep** (under the circuit breaker) repairs drift.
- **Token lifecycle:** store encrypted `refresh_token`; mint `access_token` on demand; on revocation mark the connection and prompt re‑connect.

---

## 4. Data model

Revive a **slimmed** version of the dropped tables (Google‑only, no CalDAV columns):

- **`calendar_connections`** — `id, user_id, household_id, provider('google'), refresh_token (encrypted), access_token, token_expires_at, scopes, app_calendar_id (writable Housemait calendar), sync_enabled, writes_enabled (per‑conn kill switch), status('ok'|'needs_reconnect'|'disabled'), last_inbound_sync_at, last_error, created_at`. `unique(user_id, provider)`.
- **`calendar_sync_mappings`** — `event_id ↔ (connection_id, google_event_id, etag, last_synced_at)`. **Housemait‑origin events only.** `unique(event_id, connection_id)`.
- **`calendar_write_audit`** — `id, connection_id, google_calendar_id, google_event_id, op, housemait_event_id, result, error, created_at`.
- **Inbound storage (recommended):** create **one `external_calendar_feeds` row per selected Google calendar** with `source='google'`, linked to the connection. Inbound events keep using `calendar_events.external_feed_id` — so the existing render / dedup / per‑member visibility / outbound‑feed‑exclusion / cleanup pipeline is reused **verbatim**. (Tokens live on `calendar_connections`; the feed rows just discriminate the source.)
- **Kill switch:** `GOOGLE_CAL_WRITES_ENABLED` env + a global DB flag.

---

## 5. Google Cloud / verification (Phase 0 — start now, in parallel)

- Add `calendar.readonly` + `calendar.app.created` to the **existing** OAuth consent screen. Both are **sensitive** scopes → **standard verification** (not the heavy CASA/restricted path).
- Branding: app name, logo, homepage, **privacy‑policy URL**, authorized domains.
- **Scope justification + demo video:** "read the user's calendars into a shared family view (read‑only); write family events into a dedicated *Housemait* calendar we create — we never access the user's other calendars."
- **100‑user cap** + "unverified app" screen until approved → align Phase 1/2 rollout to that cap.
- Reuse existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; web uses the GIS `oauth2` code client (incremental scope), iOS uses `ASWebAuthenticationSession`.

---

## 6. Backend components

1. `GET /api/calendar/google/connect` — start OAuth (state, offline, the two scopes).
2. OAuth callback — exchange code → encrypt+store tokens → **create the "Housemait" secondary calendar** (`calendar.app.created`) → store `app_calendar_id`.
3. `GET /api/calendar/google/calendars` — list the user's calendars for the picker.
4. `POST /api/calendar/google/select` — persist selected inbound calendars (creates the per‑calendar feed rows).
5. **Inbound pull service** — incremental `syncToken` list per selected calendar → upsert `calendar_events`; read‑only.
6. **Outbound push service** — on native‑event mutate: create/update/delete in `app_calendar_id`; write mapping + audit; **enforce circuit breaker + kill switch + tz‑correct payloads + target assertion**.
7. **Cron wiring** — inbound on the existing `externalFeed` cadence; outbound event‑driven + a guarded reconciliation sweep.
8. `DELETE` disconnect — revoke token, **delete the Housemait app calendar** (removes only our events), drop mappings, tombstone inbound events.

---

## 7. Frontend

- Connect Calendars → **"Connect Google"** tile (OAuth) → consent → **per‑calendar picker** (the per‑calendar visibility worth stealing from Nori) → done.
- Status row: connected account, last‑synced, re‑connect on token revoke, disconnect.
- Web first; iOS uses the same OAuth via in‑app browser — **the connection lives server‑side, so it follows the user from web to app with no re‑pairing** (the core reason OAuth beats device sync for a web‑first audience).

---

## 8. Testing (all green before any outbound write ships)

- **TZ round‑trip:** timed events across DST boundaries; all‑day no off‑by‑one (reuse the BST all‑day fix infra).
- **Never writes a foreign calendar:** assert every outbound call targets `app_calendar_id` only.
- **Circuit breaker:** trips at the delete threshold and executes nothing.
- **Mapping‑only delete:** a Google event absent from mappings is never deleted.
- **Echo guard:** an inbound‑sourced event never enqueues an outbound write.
- **Kill switch:** `writes_enabled=false` → zero outbound calls; inbound unaffected.
- **Token refresh + revocation** handling.

---

## 9. Rollout phases

- **Phase 0 (you, now):** submit Google verification.
- **Phase 1:** **inbound read‑only** OAuth, web, behind a flag, internal households. Ships value immediately with **zero write risk**.
- **Phase 2:** **outbound** writes to the app calendar, behind the kill switch, staged to a few households; watch audit + breaker.
- **Phase 3:** iOS OAuth; per‑calendar picker polish.
- **Phase 4 (optional):** Outlook via Microsoft Graph (same read‑scope + app/secondary‑calendar‑write model).

---

## 10. Open decisions

1. **What syncs outbound** — all household‑native events, or a per‑household / per‑event toggle? (Default: all native events; add a toggle if requested.)
2. **Token encryption** — app‑level AES‑GCM (key in env) vs `pgcrypto`.
3. **Inbound storage** — confirm the recommended "one `external_calendar_feeds` row per selected Google calendar" reuse vs. a `connection_id` column on `calendar_events`.
