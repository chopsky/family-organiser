# Kids Mode — daily-engagement build plan (streaks · badges · cosmetic shop)

Status: **scoped, decisions locked, not built.** Phased. Phase 1 = streaks + badges +
bonus stars (low risk, computes off existing data). Phase 2 = cosmetic star-shop + seasonal.

## The one principle this whole thing hangs on: decoupling

Streak value must **never** depend on the finite cosmetic pool — otherwise the day a kid
owns every theme, streaks become pointless. So:

- **Streaks reward renewable things:** bonus **stars** + milestone **badges** + the streak
  number itself (loss-aversion + pride). Streaks **never** unlock cosmetics directly.
- **Cosmetics are bought with stars only.** A streak's payout is stars; stars buy cosmetics;
  the two are decoupled so the streak keeps producing value forever.
- **Parent rewards stay the bottomless sink.** `rewards` + `/redeem` (screen time, treats,
  pocket money) means stars never become worthless even after every cosmetic is owned.
- **Seasonal cosmetic drops** keep adding fresh star-sinks over time (Phase 2).

## Locked decisions

1. **Premium-on-top cosmetics.** All 8 current themes + 22 avatars stay **free** in the Me
   screen. The star-buyable content is **new**: premium themes (Galaxy, Dino, …) + stickers.
   Nothing a kid has today is taken away.
2. **Free weekly grace.** One graced miss per ISO week doesn't break the streak (forgiving —
   avoids the rage-quit when one sick day kills a 40-day streak).
3. **Phased** (Phase 1 then Phase 2, below).

## What already exists (so we build little new plumbing)

- **Per-day completion history** — `chore_completions` (`definition_id, member_id, date,
  slot`) via `getChoreCompletionsForRange(hh, from, to)` (`src/db/queries.js`). A streak is
  **computable from this** — no new completion writes, no streak-counter table required.
- **Star ledger** — `star_transactions` (`delta, reason, ref_type, ref_id`).
  `addStarTransaction()` is **idempotent** when a `refId` is given; `getStarBalances()` sums
  deltas per member. A streak bonus is just a new `reason:'earn', refType:'streak_milestone'`
  row — idempotent by `refId`, so it fires exactly once.
- **The star sink** — parent `rewards` + `POST /api/rewards/:id/redeem` (spend = `delta:-cost,
  reason:'spend'`), with a clean refund path (`removeStarTransactionByRef`). This is our model
  for cosmetic purchases too.
- **Completion → star hook** — `POST /api/chores/:id/complete` (`src/routes/chores.js:199`)
  already credits stars to a dependent on a *new* completion. This is the natural place to
  recompute the streak and fire a milestone award.
- **Themes** — `web/src/lib/kidsTheme.js`: 8 `KID_COLOR_PRESETS` + 22 `KID_AVATARS`, persisted
  as `kid_color` / `kid_avatar` on the child's `users` row. **Currently all free**, picked in
  the Me screen — so Phase 2 adds a `premium` flag + ownership gate rather than changing the
  free ones.
- **Kids skin** — `KidsShell` tabs Quests(`/tasks`) · Star Shop(`/rewards`) · My Days · Note ·
  Me. `Celebrate` / `StarPill` live in `web/src/pages/kids/ui.jsx`.

## How a streak is defined (recommended — baked into the plan)

For a kid `K` on date `D`:
- **Due set** = quests assigned to `K` due on `D` (their assigned chores + routine slots,
  minus household `chore_skips` for `D`).
- `D` is **satisfied** if every due quest has a `chore_completion` by `K` — **or** the due set
  is empty (a no-chores day is vacuously satisfied, so a chore-free weekend never punishes).
- **current_streak** = consecutive satisfied days ending at the most recent elapsed day.
  Today counts once satisfied; if today isn't satisfied yet but isn't over, the streak is
  **at risk**, not broken (the Quests card nudges "keep it alive today").
- **Grace** = walking backward, at most **one** graced (unsatisfied) day is tolerated **per
  ISO week (Mon–Sun)**. A second unsatisfied day in the same ISO week breaks the streak.
  Deterministic and explainable to a kid: "you get one skip each week."
- **longest_streak** = max run over full history, computed in the same backward pass.

Everything above is a pure function of `chore_completions` + chore defs + skips. No drift, no
migration for the counter.

---

## Phase 1 — streak engine + badges + bonus stars

### Data
- **No new completion writes.** `current`/`longest` computed on read.
- New table **`kid_badges`** — `(household_id, member_id, badge_key text, earned_on date,
  meta jsonb null)`, unique `(member_id, badge_key)`. Milestone badges are once-ever; the
  unique constraint makes the insert idempotent.
- Milestone **bonus stars** fire through the existing ledger idempotency:
  `addStarTransaction({ reason:'earn', refType:'streak_milestone', refId:
  \`${memberId}:${tier}\`, delta })` → awarded once ever per tier per kid.

### Awards (tune later)
- **Badge + bonus tiers:** 7 → +5★ · 30 → +20★ · 100 → +50★ · 365 → +150★, plus a
  **personal-best** badge when `current` exceeds the prior `longest`.
- Milestones only (no per-day star drip) so we don't inflate the currency and undercut the sink.

### Backend
- `src/db/queries.js` — `computeKidStreak(hh, memberId, asOf)` (reads range + defs + skips,
  returns `{ current, longest, satisfiedToday, atRisk, nextMilestone }`); `getKidBadges`,
  `addKidBadge`.
- `src/routes/chores.js` `POST /:id/complete` — after recording a **new** dependent
  completion, recompute that member's streak; if it crossed an un-awarded tier, insert the
  badge + credit bonus stars (both idempotent). Include a `streak` block in the response.
- Fold `streak` + `badges` into the existing Quests day-load payload (the GET that already
  returns the per-member `done` map + balances) so the Quests screen gets it in one call.

### Frontend
- `web/src/pages/kids/QuestsScreen.jsx` — **streak card** at the top (flame + number, state:
  going / at-risk-today / broken), milestone hit → `Celebrate` from `ui.jsx`.
- `web/src/pages/kids/MeScreen.jsx` — **badge shelf** (earned milestone + personal-best badges
  with dates).
- Optional `web/src/lib/kidsStreak.js` — client-side copy/formatting helpers.

### Migration (PENDING user run — same convention as other migration-*.sql)
- `supabase/migration-kids-streak.sql` — `kid_badges` + indexes.

### Tests
- Jest unit tests for `computeKidStreak`: no-due days are neutral; one graced miss per ISO week
  holds, a second breaks; `longest` across history; milestone award idempotency (repeat taps /
  uncomplete-recomplete never double-credit).

---

## Phase 2 — cosmetic star-shop (premium-on-top) + seasonal drops

### Data
- **Catalogue in code** (not a table) — `web/src/lib/kidsCosmetics.js` +
  `premium` flag on new `KID_COLOR_PRESETS` entries: `{ key, kind:'theme'|'sticker', cost,
  season? }`. Seasonal entries gated by a date window.
- New table **`kid_cosmetics_owned`** — `(household_id, member_id, cosmetic_key,
  acquired_on, source 'star'|'seasonal')`, unique `(member_id, cosmetic_key)`.
- **Purchase = spend stars**, mirroring rewards/redeem: verify balance ≥ cost →
  `addStarTransaction({ reason:'spend', refType:'cosmetic', refId:<owned id> })` + insert
  owned row; refund via `removeStarTransactionByRef('cosmetic', id)`.
- Free themes stay `premium:false` and always selectable; premium themes render **locked**
  until owned.

### Backend
- `src/routes/kids.js` — `POST /api/kids/cosmetics/:key/buy` `{ member_id }` and
  `GET /api/kids/cosmetics?member_id=` (owned + catalogue + affordability).

### Frontend
- `web/src/pages/kids/ShopScreen.jsx` — add a **Cosmetics** section beside the existing parent
  rewards (kid spends their **own** stars). Parent rewards stay as the durable real-world sink.
- `web/src/pages/kids/MeScreen.jsx` — theme picker respects ownership (premium locked → buy).
- Stickers surface on the kid's Me header + Quests celebration (net-new UI to design).
- Seasonal: catalogue entries gated by the current date window.

### Migration (PENDING user run)
- `supabase/migration-kids-cosmetics.sql` — `kid_cosmetics_owned` + indexes.

---

## Verification (both phases)
- Jest (streak units + a route test) + full suite green; `npx eslint` on changed files (no NEW
  errors vs. the known baselines); `npx vite build`; `npx cap sync ios`.
- Preview in **Child Mode** (`localStorage.childMode='1'`, `/tasks`) on a demo dependent
  (Olivia/Henry): complete all today's quests → streak card increments; seed history to cross a
  milestone → bonus stars + badge + celebration; miss a day within grace → streak holds; a
  second miss the same ISO week → breaks. Phase 2: buy a premium theme with stars → it unlocks
  in the Me picker and balance drops; parent rewards remain affordable (sink intact).

## Sub-decisions already defaulted (change here if wanted)
- Streak "satisfied" = all due done; **no-due day = neutral** (carries the streak).
- Grace = **one graced miss per ISO week**.
- Bonus schedule **5 / 20 / 50 / 150**; badge tiers **7 / 30 / 100 / 365** + personal-best.
