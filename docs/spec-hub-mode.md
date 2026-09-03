# Spec: Hub Mode (turn a tablet into the family display)

Status: SPEC ONLY - not built. Scoped 2026-09-03 after the founder asked
whether Housemait should answer Skylight, Hearth, Nori's device and Sense's
"Sense Hub" with a display mode of its own.

The competitors sell hardware at $159-$329 for one purpose. Sense answers it
with a software mode on a tablet the family already owns, and harvests the
search intent with a "Skylight alternative" page. Housemait can do the same
for a fraction of the build, because the hard part - swapping the entire UI
for a different shell, locked per device behind a household PIN - already
ships as Child Mode.

**Why this and not something else.** Acquisition is not the problem: 84 new
households in the 28 days to 2026-09-03. Retention and monetisation are (93
trialing, 62 expired, 0 paying). A screen on the kitchen counter is the
highest-frequency touchpoint available, seen by people who never open the
app, and it makes the shared-family thesis physical instead of leaving it on
one parent's phone.

## What exists today (verified against code)

- **The shell-swap pattern.** `App.jsx:216-226` `ChildGate` renders
  `KidsShell` instead of the adult `Layout` + page, driven by
  `useChildMode()`. `pages/kids/` holds a complete alternate shell
  (`KidsShell`, `QuestsScreen`, `ShopScreen`, `DaysScreen`, `MeScreen`,
  `NoteScreen`, `ui.jsx`). Hub Mode is a third shell in the same slot.
- **Per-device mode + household PIN.** `ChildModeContext.jsx` holds
  `enabled` in `localStorage.childMode`, with the PIN on the household
  (`household.child_mode_pin_set`), synced across devices. It resets on any
  auth-identity change and re-locks Settings on navigation away. Hub Mode
  reuses this shape exactly, including the reset-on-identity rule.
- **The data.** `GET /api/digest` already returns everything four of the
  five panes need, in one call: `todayEvents`, `weekMeals`, `taskScores`
  (per-member chores done/total for today), `shoppingItems` +
  `shoppingCount`, `members`, `household`, `upcoming`, `outstanding`. No new
  endpoint is required for v1.
- **Live updates.** The app already broadcasts `housemait:data-changed`, and
  `useAppForegroundRefresh` re-pulls on foreground.
- **Chore toggling** exists (chore definitions + completions per date), so
  ticking a chore on the hub reuses the Chores page's mutation.

**Not present:** any keep-awake capability. `package.json` has no
screen-wake plugin.

## Design

### 1. Entry and exit

- Settings gains a **Display** row beside Child Mode: "Hub Mode - turn this
  device into the family display".
- Turning it on sets `localStorage.hubMode = '1'` and, if a Child Mode PIN
  is set on the household, requires that PIN to turn OFF. One PIN, two
  modes; do not introduce a second secret.
- If no PIN is set, Hub Mode still works, exit is just unguarded. Prompt to
  set one at enable time, do not force it.
- Reset on auth-identity change, copying `ChildModeContext`'s `hhRef`
  first-run skip so a plain reload keeps the hub locked but a logout or
  household switch drops out of it.

### 2. Shell

- New `pages/hub/HubShell.jsx`, rendered by a `HubGate` in `App.jsx`
  immediately **before** `ChildGate` (a device is a hub or a kid's device,
  never both; hub wins).
- Full-bleed, no nav, no scroll. Designed for reading at two metres:
  minimum body size 22px, headings 40px+, high contrast on `--cream`.
- Landscape and portrait both supported by the same flex layout, no
  device-specific branches.

### 3. Panes

Auto-advance every 20s, swipe or tap-dots to move manually, pausing
auto-advance for 60s after any manual interaction.

1. **Today** - today's events from `todayEvents`, colour-coded by member,
   with the current time marked. The default pane and the one it returns to.
2. **This week** - a seven-column strip, each day's events condensed.
3. **Meals** - `weekMeals`, today's dinner given the most weight.
4. **Chores** - `taskScores` per member as progress rings. Tappable: a tap
   toggles that member's chore list open, a second tap ticks an item. This
   is the only writing surface in v1.
5. **Photos** - out of scope for v1, see below.

### 4. Always-on

- Add `@capacitor-community/keep-awake`, enabled only while `hubMode` is on
  and released on exit. Web (non-native) falls back to the Screen Wake Lock
  API where available and simply does nothing where not.
- **Night dim** is a CSS scrim, not real brightness control: a
  `rgba(0,0,0,α)` overlay ramping from 0 to 0.55 between a configurable
  start and end hour (default 21:00 to 06:30). Cross-platform brightness
  control needs native code on both platforms and is not worth it for v1.
  Any touch clears the scrim for 30s.
- **Burn-in**: shift the whole layout by a few pixels on a slow cycle, and
  rely on the pane rotation and the night scrim. Do not claim burn-in is
  impossible in any copy.

### 5. Refresh

- Poll `GET /api/digest` every 60s while visible, plus the existing
  `housemait:data-changed` listener for instant local updates.
- On a failed poll keep the last good render and show a small stale marker
  after 5 minutes. A hub that goes blank on a flaky kitchen wifi connection
  is worse than one showing slightly old data.

### 6. Settings within Hub Mode

- Long-press anywhere for 2s reveals a minimal bar: exit (PIN), pane
  selection, night-dim hours. Nothing else. No navigation into the app.

## Distribution reality (do not gloss over this)

- **Fire tablets** are the "$50 tablet" in every competitor's marketing, and
  they do not ship Google Play. Housemait would need an Amazon Appstore
  listing or the family sideloads. Decide before writing the copy: either
  publish to Amazon or say "any Android or iPad" and leave Fire out.
- **Old iPads**: the app's `IPHONEOS_DEPLOYMENT_TARGET` is 15.0, so roughly
  iPad Air 2 (2014) and later. "Any old iPad" is close enough to true but
  the marketing should not promise iOS 12 hardware.
- Hub Mode is a **free** feature. It is the reason to keep the app, not a
  thing to sell, and gating it would undercut the whole Skylight argument.

## Out of scope for v1

- Photo slideshow. It needs a photo source (Photos permission or uploads),
  which is its own build. Add it after the hub proves itself.
- Real screen-brightness control.
- A separate hub-only login or a household "display account".
- Amazon Appstore publication (decide, but do not block v1 on it).

## Build order and effort

- **Phase 1 (about 2 days), the testable version:** entry/exit + PIN, the
  shell, Today and This week panes, keep-awake, digest polling. Enough to
  put on the founder's counter for a week.
- **Phase 2 (about 1 day):** Meals and Chores panes, chore ticking, night
  dim, long-press bar.
- **Phase 3, only if phase 1 earns it:** photo slideshow, Amazon Appstore,
  the `/skylight-alternative` landing page and comparison table (the same
  playbook as `/maple-alternative`).

## Verification

1. `npx jest` from repo root: green, including a `ChildModeContext`-style
   test that Hub Mode resets on identity change and that hub wins over
   child when both flags are set.
2. `cd web && npm run build`, then `npx cap sync android` and run on a real
   tablet in both orientations.
3. Leave it running 24h on the founder's counter: confirm the screen stays
   awake, the night scrim ramps, the panes rotate, and a flaky-wifi period
   shows stale data rather than a blank screen.
4. Confirm exiting requires the PIN, and that a kid can tick a chore but
   cannot reach Settings or any other route.

## Open question for the founder

Does the hub show a **household** view only, or can a member "claim" it
briefly to see their own day? Recommendation: household only in v1. A hub
that needs identity becomes a login problem, and the whole point is that it
is ambient and belongs to nobody.
