# Spec: Free app, metered assistant (the pricing model)

Status: DECIDED 2026-08-27, REVISED 2026-08-27 (founder) - the hard
assistant gate became a 10-action monthly meter after the expired-cohort
analysis showed four habitual households dying at the wall with zero
conversions (one tried the bot post-expiry, was refused, went silent).
Supersedes `docs/spec-soft-wall-free-mode.md` (the hard wall was pulled
from App Review on 2026-08-27; its fortnight experiment never ran). Most
of this deploys server-side with NO App Store submission.

## The model in one sentence

**Housemait is free for the whole family, including 10 free AI uses
a month. Premium is unlimited assistant plus the automations
that feed it - calendar sync, document + attachment uploads, the daily
briefs. £5.99 a month or £59.99 a year, one subscription per household,
full premium free for the first 14 days.**

## How it was decided (the competitor map)

| | Free tier | AI on free | Gates |
|---|---|---|---|
| Cozi | Generous + ads | n/a | Feature nags; 2024 squeeze angered users |
| Sense | Manual calendar/lists only | 10 extractions/mo (chat itself UNMETERED - affordable only because their free features are crippled) | TWO gates (features + meter) - confusing |
| Nori | ALL features | 10 AI uses/mo (any chat) | One meter - simple but taxes conversation (founder-verified 2026-08-27: two consecutive shopping adds burned 2 uses) |
| **Housemait** | **Full shared app, manual** | **10 actions/mo (burst unit)** | **Meter + cost-centre features only** |

Rejected on the way here: the hard onboarding wall (fear of strangling
the base; never launched, machinery mothballed not deleted); the hard
post-trial assistant gate (v1 of this spec - the wall killed habitual
households instead of converting them); RAW MESSAGE metering (taxing
replies to the bot's own follow-up questions punishes our deliberately
conversational design - Nori's flaw); Sense's two-gate breadth (its own
bot needed three messages to explain it; our gates are cost-centres
only); gating Child Mode (it's the habit engine - chore ticks are 28%
of all deliberate actions estate-wide - and "pay to make the app
kid-safe" is unacceptable optics, especially post the 2.3.6 age-rating
review round).

## The line

### Free forever (the shared family app)
- Calendar (manual events, recurring, skips), lists incl. named lists,
  to-dos, chores + routines + stars, **Kids Mode / Child Mode
  (deliberately free - the habit engine and half a safety feature)**,
  meal planner + recipes, notes, kids' daily notes.
- School term dates (cached per school, negligible cost, THE
  differentiator and the ad campaign's promise - never gated, never
  metered).
- Party invites + RSVPs, family invites/codes, joining (growth loops are
  never gated).
- Reading, downloading and exporting EVERYTHING, documents included.
  Data is never hostage - the promise is literal.
- Push notifications for the above (event reminders stay).
- **10 AI uses a month, per household** (see the meter).

### Premium (unlimited assistant + the standing automations)
The dividing principle: **requests are metered, automations are
premium.** A request is anything the family asks for, in any modality -
typed, voice note, photo, or an email from a sender they approved
(approving the sender is the consent that covers the stream - the
Nori/Sense norm, founder-verified 2026-08-28). An automation is
something that works for them without being asked (calendar sync,
briefs).
- Unlimited AI uses (free gets 10 a month; voice, photo and
  approved-sender email requests count like any other - no modality
  cliff). User-facing term everywhere: **"AI uses"** (founder's copy;
  "assistant actions" retired 2026-08-28).
- REJECTED: Sense-style unmetered free chat. Sense can give chat away
  because its free tier is feature-crippled (manual-only); our model is
  the inverse - every feature free, the assistant metered. Copying
  their chat policy without their feature gates would give away both
  halves and leave Premium selling nothing the engaged family feels.
- Morning + evening briefs, weekly digest (premium-only, NOT metered -
  daily briefs would burn a 10-meter in a week).
- Document + event-attachment UPLOADS (storage is the one cost that
  grows permanently per household; existing files stay readable - gate
  the door, not the vault).
- External calendar sync (Google OAuth, ICS feeds - recurring polling
  cost for the household's lifetime; Sense gates the same).

## The meter (the heart of the model)

### Unit: one BURST, not one message
- **A 10-minute block anchored at the burst's FIRST message** (DECIDED
  2026-08-28, build go). Anything asked inside the block is the same
  action; the clock does NOT restart per message, so a long
  consultation charges roughly one action per 10 minutes instead of
  riding one action forever. The window buys the GAPS in distracted
  use ("add milk"... unpacking... "and bin bags"... "oh and Calpol" =
  one restock), not ten minutes of talking.
- **Chain exception**: answering the bot's open question NEVER starts
  a new action, even when the block has expired - charging someone for
  answering our own question is the Nori sin the unit exists to avoid.
  "Add padel Thursday" -> confirmation with its auto-reminder -> "make
  it an hour before" is ONE action.
- The generosity is deliberate: what premium sells is the assistant
  being there ALL MONTH (the 8am ask, the 1pm ask, the 6pm ask) - a
  daily-habit household still generates ~30-90 bursts against a limit
  of 10. A family doing their weekly admin in one dense session is a
  family learning the product's value, capped at 10 such sessions. If
  the exhaustion metric shows the meter never binding, the window
  shrinks to 5 minutes with a one-line change.
- Failed or refused actions charge nothing ("I couldn't find that
  event" is our miss, not their spend).
- Replying to anything the BOT initiated never charges - an exchange
  that was the bot's idea is never the family's spend.
- APPROVED-SENDER EMAILS count as AI uses (each arriving email = one,
  bursts merging near-simultaneous forwards). At the limit an email is
  NOT extracted and never silently: the inbox log says why, the
  household gets at most one push a day, and the photo path stays open
  as the escape hatch. The sender-approval flow must DISCLOSE the
  metering ("emails from this sender use your free AI allowance") -
  that disclosure is what makes third-party sending consented rather
  than a sleeping drain.
- Meta-questions about the meter charge nothing and always get an
  exact, deterministic answer ("how many do I have left?" -> "3 of 10
  left; resets 1 September"). Sense's bot fumbles its own quota
  mechanics; ours never will because the answer never touches a model.
- Proactive outbound (nudges, confirmations, RSVP notifications) never
  counts - the family didn't ask.
- Applies identically to WhatsApp and in-app chat; one household-level
  pool (matches household-level billing).

### Reset: calendar month
- Resets on the 1st, anchored to the household's timezone, so "your 10
  free actions are back on 1 September" is always true as written.
- No rollover. Partial first months are generous: whenever the trial
  ends, the household gets the full 10 for the remainder of that month.
- Chosen over rolling-30-days for explainability (one sentence, one
  shared household date), implementation simplicity (count this month's
  rows, no sliding-window bookkeeping), and the monthly re-engagement
  drumbeat (the bot comes back to life on the 1st for every lapsed
  household - win-back copy can lean on the date).

### Channel doctrine: conversation on WhatsApp, pings on push

DECIDED 2026-08-27 (founder). **Every one-way ping is a push
notification for everyone, both tiers** - not WhatsApp. That covers
event reminders, the overdue-task nudge, the school-prep reminder, and
activity broadcasts ("Grant added Padel Thursday"); the holiday-pause
notice is a push already. Three reasons: zero marginal cost; zero Meta
compliance surface (the resilience doctrine - routine
business-initiated template traffic is exactly what gets platforms
evicted, see docs/whatsapp-resilience.md); and it makes the app
install the delivery mechanism. WhatsApp carries the CONVERSATION:
requests to the bot (free inside the meter, unlimited on premium),
briefs (premium), and the day-1-3 capture openers (which run inside
the trial by construction, so they never reach a free household).
"Nudges" need no tier of their own - the ping/conversation split sorts
every sender.

Every WhatsApp-linked person holds an account (linking requires a
signed-in verification code - there is no account-less member), but
~25% of linked users are push-unreachable (web-only signups, or app
installed with notifications declined). The bot coaches by cause when
they set a reminder:
- No app: "I'll set that reminder - grab the app so it can reach you:
  [link]". The reminder is created either way; the install is the
  delivery mechanism, not a toll booth. The app is free, so this ask
  now costs the user nothing (the hard wall used to poison it).
- App but notifications declined: point at the settings toggle, not
  the App Store; the app re-prompts on next open.
- Bot confirmations must name the channel ("I'll send you a
  notification 30 minutes before") - a person promised something in
  WhatsApp who then sees silence there assumes the reminder failed.

Transition: the currently push-unreachable users who receive WhatsApp
reminders today get ONE honest WhatsApp message explaining the change
with the app link - never silent disappearance of a thing they rely
on.

Auto-reminders (SHIPPED 2026-08-27, live for everyone the bot serves):
a bot-created timed event automatically carries a 30-minute reminder -
the default, not a question; adjustment and removal are follow-ups
inside the same burst. Full behaviour and guards live with the reply
ladder (docs/bot-reply-ladder.md).

### Quota visibility (the WhatsApp problem)
The rule behind the ladder: no step may be the first mention of the
step before it - the meter is announced, never discovered.
0. **The deal is introduced at trial's end** - one WhatsApp message
   (WhatsApp-linked households only; a one-time lifecycle notice about
   the channel it arrives on, outside the pings-on-push doctrine, which
   governs RECURRING one-way traffic) + the trial-expiry email + the
   in-app banner. Deliberately no push: anyone push-reachable has the
   app and sees the banner. Copy: "the app stays free forever; the
   assistant gives you 10 free actions a month, resetting on the 1st."
   A counter appearing at 7 is only unsurprising if the meter's
   existence was already news the family received.
   MECHANICS: most lapsing households are OUTSIDE the 24h WhatsApp
   window (the quiet ones especially), where free-form sends are
   rejected - the proactive send uses a pre-approved utility template
   (one per household ever, ~2p; the digest already runs on this
   machinery; template needs Meta approval BEFORE launch - see the
   implementation map). Belt-and-braces: the bot's FIRST reply after
   lapse restates the deal inline before anything else - free,
   in-window by definition, and it reaches exactly the people the
   meter affects. No one can reach action 7 untold.
1. **First action of each month carries a full-tank line**: "(1 of 10 -
   your free actions reset 1 October)". Not a standalone send - it
   rides the bot's reply to that first action, in whichever channel
   the family asked (WhatsApp or app chat); a household that doesn't
   use the assistant that month never sees it. Doubles as the monthly
   "bot is back" re-engagement beat, and restates the deal when the
   news is good, not when it's nearly bad. Then silent from 2-6 (a
   counter on action 3 is noise), and from action 7 the reply that
   starts a new action appends the countdown - "(8 of 10 free actions
   used this month)".
2. **Ask anytime, free**: remaining-quota questions are deterministic,
   exact, never charged.
3. **The limit message**: warm, names the reset date, offers both doors
   - "add it in the app (always free)" with a deep link, or upgrade.
   After that, further AI requests get a short deterministic version at
   most once a day per household (no lecture-spam, zero token cost).
   The upgrade door is per-platform: iOS IAP and web Stripe are live;
   Android's arrives with the Play Billing build - until then the
   Android limit message links the web checkout, not a dead end.
4. The same counter appears in the app's chat screen and on the upgrade
   screen - one story everywhere.

## Trial

- 14 days, full premium, no card, unchanged (version-aware machinery
  stays as shipped). Trial length is deliberately NOT the lever in this
  model - the lapse experience is - so we stop churning it. Shortening
  later is one line in trial-length.js if data demands.
- No onboarding wall on any platform. The paywall screen + PaywallGate +
  paywall_required stamping are mothballed behind their existing flags,
  not deleted (paywallRequiredForRequest returns false; the telemetry
  table stays for any future upsell screen).

## The lapse experience (the conversion moment)

- Trial ends -> household drops to free and keeps working, but the
  SWITCH is never silent: the lapse moment announces the new deal on
  every channel the family uses (quota ladder step 0). The bot NEVER
  goes silent either: it keeps answering inside the meter, and at the
  limit gives the warm two-door reply above.
- Upload attempts, calendar-connect attempts, brief settings: warm
  server-side refusals with the same one-line story, never errors.
- The app itself keeps working fully for manual use - the middleware's
  expired-402 branch frees manual writes.
- Briefs stop with a final farewell brief that says why (one send, not
  silence).
- Launch day flips the ~36 currently-expired households to free tier -
  the built-in win-back moment (Kirkstone Manor's booking diary,
  Williams' France lists, Hazell/Powell's school calendar all come back
  to life), and it retires the current awkwardness of nudging expired
  families about tasks the gate won't let them act on.

## Implementation map (ALL server-side - no store submission)

1. Meter: household-month action counter (new table or derived from
   ai_usage_log + whatsapp/chat logs), charged on the first successful
   request of a burst (>10 min since the last charged action) in the
   bot pipeline + chat route; counter line appended by the reply
   builder; limit reply deterministic + once-a-day throttled, checked
   BEFORE the model pipeline so over-limit traffic costs no tokens.
2. `src/middleware/subscriptionStatus.js` - lapsed households: allow
   manual writes; gate upload/sync/brief routes; assistant routes defer
   to the meter instead of refusing outright.
3. `src/routes/whatsapp.js` + chat route - expiry gate becomes the
   meter check; copy becomes the free-app framing.
4. `src/routes/documents + calendar event attachments` - upload routes
   check premium; reads/downloads untouched.
5. Calendar connect routes + feed-sync jobs - new connections premium;
   existing feeds of lapsed households pause (not delete).
6. Brief jobs - skip lapsed households after one farewell send.
6b. Inbound email - approved-sender emails charge the meter; at the
   limit the email is logged unprocessed + one push a day; approval
   flow discloses metering (client copy, rides next app build).
7. Ping delivery - route reminders, overdue/school-prep nudges, and
   broadcasts to push for push-capable users (both tiers); bot copy
   names the channel + coaches install/settings when unreachable;
   one-time WhatsApp heads-up to today's push-unreachable recipients
   when the routing flips.
8. Postmark trial-expiry templates - copy to the new framing (manual).
8b. WhatsApp lapse-announcement TEMPLATE - submit for Meta approval
   BEFORE launch (utility category, one variable for the reset date);
   out-of-window households are the majority of lapses and free-form
   sends to them are rejected. Founder task, like the Postmark edits.
9. Copy sweep (bundle-side, rides next regular build): Settings expired
   banners, TrialIndicator, onboarding paywall phase removed, landing
   pages, in-app meter display. KNOWN STALE: the new marketing site
   prototype's hero still says "Free 30-day trial".
10. Rollout: single env flag (FREE_APP_MODE=1) flips the estate, so the
   currently-expired + all expiring households switch the moment it's
   on. Reversible by unsetting.

## Metrics that replace the paywall funnel

Trial->paid conversion, lapsed->paid reactivation, meter exhaustion
rate (share of free households hitting 10 - the direct upgrade-pressure
gauge), actions-per-household distribution (is 10 the right number),
upload/sync gate hits by lapsed households (demand signals), and
WhatsApp-link rate - the meter can only bind on households that talk
to the bot, so linking is the monetisation-critical funnel step. The
admin paywall-funnel panel gets repurposed to this once the gates ship.

## v2 candidates (only if data asks)

- Tune the 10, or the burst window (engaged households run 20-70 bot
  messages a fortnight, so 10 bursts/month should bind mid-month for
  the engaged - verify with the exhaustion-rate metric before moving
  either knob).
- Shorter trial if habit-to-lapse is reliably formed inside a week.
- Storage cap instead of hard upload gate if support asks for it.
