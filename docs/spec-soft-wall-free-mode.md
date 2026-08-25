# Spec: soft wall + free mode (the pre-built flip for the paywall experiment)

Status: SPEC ONLY - not built. Written 2026-08-26 while the 1.13.0 hard
paywall sits in App Review. Purpose: if the hard wall's first fortnight
says "too expensive" (agreed thresholds below), flipping to this design is
a day of assembly, not a rethink. Decision context in the founder chat of
2026-08-26 (Cozi-freemium argument vs zero-conversion history of the old
soft model).

## Decision thresholds (agreed, hold the hard wall until then)

Fortnight from public 1.13.0 release: flip only if BOTH
- iOS signups/day fall >60% vs the pre-wall baseline, AND
- paywall completion (trial started / wall shown) < 25%.
One of the two alone = keep the wall another fortnight and re-read.

## The design in one line

The wall stays exactly where it is - but declining it becomes survivable:
a quiet "Continue with the free version" path, and the post-trial state
becomes a limited FREE MODE instead of a lockout, for everyone.

## 1. The skip affordance (app build required)

- paywallScreen.jsx gains a ghost under the plans: "Continue with the free
  version" - deliberately quiet, below the fold of the two plan cards.
- Skipping records the choice (see telemetry) and proceeds to 'done'. The
  skipper runs on the server-side 14-day trial that signup already created
  - full product, no card.
- PaywallGate (the launch gate) honours the same state: a skipper is
  'trialing' so the gate already passes; when the trial lapses they land
  in free mode, never a wall they can't decline (the gate's PaywallScreen
  gets the same ghost).
- Copy rule: the ghost never says "free forever" - "the free version"
  keeps the shape honest (limited, upgradeable).

## 2. Free mode = what "expired" becomes (server + web, no app build)

No new status. subscription_status 'expired' stays the stored state; free
mode is a change in what expired MEANS. Flag-gated: FREE_MODE=1 on
Railway flips the behaviour estate-wide (default off until the decision).

What stays free forever (the network must keep breathing):
- Shared calendar, lists, tasks/chores, meal plan - full MANUAL use.
- All household members, invites, party RSVP links.
- Reading everything. Data is never held hostage.

What the free tier limits (the upgrade pitch):
- AI: 10 prompts/day per household, WhatsApp + app chat combined.
  Counted from ai_usage_log (features classify/chat, per household per
  local day) - the table already exists, no migration. Prompt 11 gets a
  warm one-liner: "That's the free plan's 10 for today - unlimited is
  £5.99/month: <link>". The bot's current expired-lockout reply is
  RETIRED under the flag.
- Automation off: morning/evening briefs, event reminder pushes, inbound
  email processing (reply: "the house inbox is a premium feature now that
  your trial's ended"), term-dates auto-refresh.
- WhatsApp media (voice notes, letter photos) count as 2 prompts each
  (they cost a transcription/vision call on top).

Middleware change: the expired 402-on-writes branch becomes
free-mode-aware - manual writes pass, AI/automation endpoints check the
quota or the premium gate. The trial-expiry emails swap "your trial ended,
subscribe to keep access" copy for "you're on the free plan now" (Postmark
template edit - manual, like all templates).

## 3. Telemetry (build NOW, before the flip - it decides the flip)

New table paywall_events (tiny migration): household_id, user_id,
outcome ('shown' | 'converted' | 'skipped' | 'abandoned'), platform,
created_at. Written from the paywall screen (shown/converted/skipped) and
derived for abandoned (shown with no terminal event in 24h).
Admin panel "Paywall funnel" (clone the referral panel): signups → wall
shown → converted / skipped / abandoned, plus D7 activation per outcome
cohort and free→paid upgrades once free mode is live. This panel is worth
building even if the flip never happens - it's the hard wall's scoreboard
too.

## 4. What deliberately does NOT change

- Joiners: still never see any wall (owner-only billing).
- Web signup: stays cardless opt-in (it already is the soft path).
- Android: opt-in until Play Billing bedding-in is proven.
- Existing active/trialing households: untouched.
- The 14-day trial length and the Apple intro offer: untouched - the
  experiment is about the WALL, not the trial.

## Effort

Telemetry + admin panel ~half a day (do first). Free-mode server gating +
quota ~1 day. Skip ghost + gate parity ~half a day, rides the next iOS
build. Postmark copy manual.

## Later / out of scope

- A marketed "Free plan" on the pricing page (only if free mode graduates
  from fallback to strategy).
- Ads in the free tier (Cozi's model) - not before real volume.
- Prompt-quota tiers as the PRIMARY monetisation (rejected: nags the most
  engaged; the quota here is a floor under a lapsed trial, not the pitch).
