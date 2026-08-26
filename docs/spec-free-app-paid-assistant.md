# Spec: Free app, metered assistant (the pricing model)

Status: DECIDED 2026-08-27, REVISED 2026-08-27 (founder) - the hard
assistant gate became a 10-action monthly meter after the expired-cohort
analysis showed four habitual households dying at the wall with zero
conversions (one tried the bot post-expiry, was refused, went silent).
Supersedes `docs/spec-soft-wall-free-mode.md` (the hard wall was pulled
from App Review on 2026-08-27; its fortnight experiment never ran). Most
of this deploys server-side with NO App Store submission.

## The model in one sentence

**Housemait is free for the whole family, including 10 assistant
actions a month. Premium is unlimited assistant plus the automations
that feed it - calendar sync, document + attachment uploads, the daily
briefs. £5.99 a month or £59.99 a year, one subscription per household,
full premium free for the first 14 days.**

## How it was decided (the competitor map)

| | Free tier | AI on free | Gates |
|---|---|---|---|
| Cozi | Generous + ads | n/a | Feature nags; 2024 squeeze angered users |
| Sense | Manual calendar/lists only | 10 extractions/mo | TWO gates (features + meter) - confusing |
| Nori | ALL features | 10 AI uses/mo (any chat) | One meter - simple but taxes conversation |
| **Housemait** | **Full shared app, manual** | **10 requests/mo** | **Meter + cost-centre features only** |

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
- **10 assistant actions a month, per household** (see the meter).

### Premium (unlimited assistant + what feeds it)
- Unlimited assistant everywhere: WhatsApp, in-app AI chat, voice-note
  transcription, photo/receipt scanning.
- House email inbox (AI extraction pipeline).
- Morning + evening briefs, weekly digest (premium-only, NOT metered -
  daily briefs would burn a 10-meter in a week).
- Document + event-attachment UPLOADS (storage is the one cost that
  grows permanently per household; existing files stay readable - gate
  the door, not the vault).
- External calendar sync (Google OAuth, ICS feeds - recurring polling
  cost for the household's lifetime; Sense gates the same).

## The meter (the heart of the model)

### Unit: one REQUEST, not one message
- One user-initiated request **plus its entire follow-up chain** = 1
  action. "Add padel Thursday" -> "want a reminder?" -> "yes" -> "how
  long before?" -> "30 min" is ONE action, not four. The reply ladder
  already ties pending-question replies to their originating action, so
  the chain boundary is machinery we have, not new inference.
- Failed or refused actions charge nothing ("I couldn't find that
  event" is our miss, not their spend).
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

DECIDED 2026-08-27 (founder). **Reminders are push notifications for
everyone, both tiers** - not WhatsApp. Three reasons: zero marginal
cost; zero Meta compliance surface (the resilience doctrine - routine
business-initiated template traffic is exactly what gets platforms
evicted, see docs/whatsapp-resilience.md); and it makes the app
install the delivery mechanism. WhatsApp carries the INTERACTIVE
layer only: talking to the bot, briefs, nudges - the premium half.

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

### Quota visibility (the WhatsApp problem)
1. **Ambient counter near the edge**: from action 7 the bot appends one
   quiet line to its normal reply - "(8 of 10 free actions used this
   month)". Silent before that; a counter on action 2 is noise.
2. **Ask anytime, free**: remaining-quota questions are deterministic,
   exact, never charged.
3. **The limit message**: warm, names the reset date, offers both doors
   - "add it in the app (always free)" with a deep link, or upgrade.
   After that, further AI requests get a short deterministic version at
   most once a day per household (no lecture-spam, zero token cost).
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

- Trial ends -> household drops to free, silently keeps working. The
  bot NEVER goes silent: it keeps answering inside the meter, and at
  the limit gives the warm two-door reply above.
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
   ai_usage_log + whatsapp/chat logs), charged at request-completion in
   the bot pipeline + chat route; counter line appended by the reply
   builder; limit reply deterministic + once-a-day throttled.
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
6b. Reminder delivery - route to push for push-capable users (both
   tiers); bot copy names the channel + coaches install/settings when
   unreachable; one-time WhatsApp heads-up to today's push-unreachable
   reminder recipients when the routing flips.
7. Postmark trial-expiry templates - copy to the new framing (manual).
8. Copy sweep (bundle-side, rides next regular build): Settings expired
   banners, TrialIndicator, onboarding paywall phase removed, landing
   pages, in-app meter display. KNOWN STALE: the new marketing site
   prototype's hero still says "Free 30-day trial".
9. Rollout: single env flag (FREE_APP_MODE=1) flips the estate, so the
   currently-expired + all expiring households switch the moment it's
   on. Reversible by unsetting.

## Metrics that replace the paywall funnel

Trial->paid conversion, lapsed->paid reactivation, meter exhaustion
rate (share of free households hitting 10 - the direct upgrade-pressure
gauge), actions-per-household distribution (is 10 the right number),
upload/sync gate hits by lapsed households (demand signals). The admin
paywall-funnel panel gets repurposed to this once the gates ship.

## v2 candidates (only if data asks)

- Tune the 10 (engaged households run 20-70 bot messages a fortnight,
  so request-metered 10/month should bind mid-month for the engaged -
  verify with the exhaustion-rate metric before moving it).
- Shorter trial if habit-to-lapse is reliably formed inside a week.
- Storage cap instead of hard upload gate if support asks for it.
