# Spec: "Join an existing home" via invite code (onboarding v4)

Status: SPEC ONLY - not built. Scoped 2026-08-24 after the founder asked
where iOS onboarding offers joining an existing household. Answer: nowhere.
Joining works solely via `?invite=<token>` in the signup URL, which an App
Store cold-start install never carries - so a second adult who installs the
app directly walks the full founder flow and creates a second, disconnected
household. This spec adds a typeable short code so the invite survives the
App Store gap.

## What exists today (verified against code)

- `invites` table: `household_id, email, token (64-hex), invited_by,
  expires_at, accepted_at` + optional `name, family_role, birthday,
  color_theme, school_id`. Created admin-only via `POST /api/household/invite`
  (email invite) and shared as `https://housemait.com/signup?invite=<token>`
  from FamilySetup (WhatsApp share).
- Signup (`src/routes/auth.js` ~150-196) already accepts `inviteToken` and
  ALSO auto-matches an unaccepted invite by exact email - so the trap only
  bites when the second adult signs up with a different email than the one
  invited, or was link-invited only.
- v4 flow: `useV4Auth.js:182` passes `searchParams.get('invite')` into
  signup; `runFinish` skips create-household when the account already has one
  (`existingHousehold`). The machinery for "join" exists end to end - the
  only missing piece is a way to GET a token into the flow without a link.

## Design

### 1. Short code on every invite

- New column `invites.code`: 6 chars from `A-Z2-9` minus `I,L,O,S` (28-char
  alphabet, ~482M combos). Generated alongside the token on every new invite.
  Unique index. Old invites keep working link-only; no backfill.
- Shown wherever the link is shown: FamilySetup invite row ("or they can
  enter code **KX7-M4Q** in the app" - display with a hyphen, store without),
  and in the invite email.
- Degradation rule (house style): if the column is missing (migration not yet
  run - 42703/PGRST204), create the invite WITHOUT a code, exactly like the
  `paywall_required` retry-without-column pattern. Nothing breaks pre-migration.

### 2. Public lookup endpoint

`GET /api/invites/lookup?code=KX7M4Q` (no auth):

- Normalise: uppercase, strip spaces/hyphens; reject anything not `^[A-Z2-9]{6}$`.
- Valid + unaccepted + unexpired → `{ valid: true, householdName, inviterName,
  token, invitee: { name, family_role } }`. Returning the full token lets the
  client reuse the existing `inviteToken` signup path with zero backend
  changes to signup itself.
- Invalid/expired → `{ valid: false }` (no distinction leaked).
- Rate-limited (10/min/IP, same limiter pattern as `/api/inbox/availability`);
  fails SOFT (`valid: null`) on server trouble so onboarding never bricks.
- Enumeration maths: 482M codes, ≤ dozens live at any time, 10 tries/min -
  fine. The reward for a hit is a household display name, and the code was
  already being shared over WhatsApp in plaintext.

### 3. Entry affordances (two, both quiet)

1. **First screen (pains) footer**: small text link - "Someone already set up
   your home? **Enter your invite code**". Catches the spouse who knows they
   were invited before they answer founder questions.
2. **House step backstop**: under the name field - "Joining a home that's
   already set up?" - same code entry. Catches the late realiser.

Both open the same code screen: one 6-char input (auto-uppercase, accepts
pasted `KX7-M4Q`), debounced lookup, then a confirmation card - "You're
joining **The Shapiro family** - invited by Grant" with [Join this home]
[Wrong home? Go back]. The confirmation moment is the point: nobody should
join a household on a typo.

### 4. Flow changes once a code is confirmed (`draft.joining`)

Store `{ token, householdName, invitee }` in the onboarding draft
(`lib/onboardingDraft.js`). The machine gains a `joining` mode:

- **Skipped steps**: `pains`, `plan`, `shape`, `house`, `inbox`. Rationale:
  pains/plan exist to personalise the plan screen and the paywall (both
  skipped for joiners); shape would duplicate members the founder already
  created; house naming and inbox claiming are founder-only acts.
- **Kept steps**: `you` (prefilled from `invitee.name`), `role` (prefilled
  from `invitee.family_role`), `cals`, `ask` (WhatsApp), `reminders`.
  A 5-step joiner flow, mostly about THEIR devices and channels.
- Signup passes the draft token as `inviteToken` (URL param still wins if
  both present - same mechanism, link path unchanged).
- `runFinish`: already correct (`existingHousehold` skips create-household).
  Guards to add: `replayInbox` must not run for joiners; referral rows are
  already invitee-suppressed (existing rule, auth.js:147-150).
- **Paywall phase: skipped for joiners.** Billing is owner-only (decided
  permission model, 2026-07-20); the household's trial/subscription governs
  the joiner's access via the existing household-level gates. A joiner must
  never be offered their own Apple trial on a household that already has one.

### 5. Measurement

- Tag joiner signups `signup_source = 'invite_code'` (link path stays as-is)
  so the admin funnel can show code vs link vs email-match joins.
- Optional later: a "second household trap" radar - households created within
  N days by an email that had an unaccepted invite pending. Not in scope.

## Migration

`supabase/migration-invite-codes.sql` (house style: idempotent, RLS no
policies, `NOTIFY pgrst`): `ALTER TABLE invites ADD COLUMN IF NOT EXISTS
code text; CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_code ON invites
(code) WHERE code IS NOT NULL;` PENDING-user-run; everything degrades until
then (invites just come without codes, the lookup 404s them).

## Tests

- Lookup: valid → household name + token; expired/accepted → valid:false;
  normalisation (`kx7-m4q` → hit); rate-limit 429; DB error → valid:null.
- Invite creation: code generated; column-missing retry keeps invites working.
- Machine: `joining` skips exactly {pains, plan, shape, house, inbox};
  progress bar denominates over the reduced step list.
- Replay: inbox replay suppressed for joiners.
- Paywall: joiner never enters phase 'paywall'.
- Parity: client code alphabet/normalisation is a strict subset of the
  server's (same tripwire pattern as the inbox slug parity test).

## Effort

Backend (column + endpoint + creation + tests) ~half a day; client (code
screen + machine mode + prefills + guards + tests) ~a day; FamilySetup +
email surfacing ~an hour. Rides the NEXT app build (client is in the web
bundle but /signup v4 is native-only); the backend half ships on deploy and
benefits emailed invites immediately (code shown in email opens the web flow
too).

## Out of scope

- Deferred deep-linking SDKs (rejected - this spec exists to avoid them).
- Post-signup household merge/repair ("join a different household" from
  Settings) - separate, messier problem because the accidental household
  has data.
- Backfilling codes onto historical unaccepted invites.
