# Spec: Free app, paid assistant (the pricing model)

Status: DECIDED 2026-08-27 (founder). Supersedes
`docs/spec-soft-wall-free-mode.md` (the hard wall was pulled from App
Review on 2026-08-27; its fortnight experiment never ran). This is the
model the product converges on, and most of it deploys server-side with
NO App Store submission.

## The model in one sentence

**Housemait is free for the whole family. Premium is the assistant and
the automations that feed it - WhatsApp, email-in, calendar sync,
document storage, the daily briefs. £5.99 a month or £59.99 a year, one
subscription per household, free for the first 14 days.**

## How it was decided (the competitor map)

| | Free tier | AI on free | Gates |
|---|---|---|---|
| Cozi | Generous + ads | n/a | Feature nags; 2024 squeeze angered users |
| Sense | Manual calendar/lists only | 10 extractions/mo | TWO gates (features + meter) - confusing |
| Nori | ALL features | 10 AI uses/mo (any chat) | One meter - simple but taxes conversation |
| **Housemait** | **Full shared app, manual** | **None post-trial** | **One gate: the assistant channel** |

Rejected on the way here: the hard onboarding wall (fear of strangling
the base; never launched, machinery mothballed not deleted); universal
prompt meters (taxing replies to the bot's own follow-up questions
punishes our deliberately conversational design); Sense's two-gate model
(its own bot needed three messages to explain it); outcome-metering
(elegant - conversation free, completed tasks counted - and kept as the
documented v2 if lapsed families never re-convert without a taste).

## The line

### Free forever (the shared family app)
- Calendar (manual events, recurring, skips), lists incl. named lists,
  to-dos, chores + routines + stars, Kids Mode, meal planner + recipes,
  notes, kids' daily notes.
- School term dates (cached per school, negligible cost, THE
  differentiator and the ad campaign's promise - never gate).
- Party invites + RSVPs, family invites/codes, joining (growth loops are
  never gated).
- Reading, downloading and exporting EVERYTHING, documents included.
  Data is never hostage - the promise is literal.
- Push notifications for the above (event reminders stay).

### Premium (the assistant + what feeds it)
- The assistant everywhere: WhatsApp (both directions - broadcasts to
  app-less members are per-message Twilio cost), in-app AI chat,
  voice-note transcription, photo/receipt scanning.
- House email inbox (AI extraction pipeline).
- Morning + evening briefs, weekly digest.
- Document + event-attachment UPLOADS (storage is the one cost that
  grows permanently per household; existing files stay readable - gate
  the door, not the vault).
- External calendar sync (Google OAuth, ICS feeds - recurring polling
  cost for the household's lifetime; Sense gates the same).

### Trial
- 14 days, full premium, no card, unchanged (version-aware machinery
  stays as shipped). Trial length is deliberately NOT the lever in this
  model - the lapse experience is - so we stop churning it. Shortening
  later is one line in trial-length.js if data demands.
- No onboarding wall on any platform. The paywall screen + PaywallGate +
  paywall_required stamping are mothballed behind their existing flags,
  not deleted (paywallRequiredForRequest returns false; the telemetry
  table stays for any future upsell screen).

## The lapse experience (the conversion moment)

- The bot NEVER goes silent. A lapsed member messaging it gets one warm
  gated reply (existing expiry-gate machinery, new copy): the app is
  still free and working; the assistant is the premium bit; £5.99/month
  link. Same for in-app chat.
- Upload attempts, calendar-connect attempts, brief settings: warm
  server-side refusals with the same one-line story, never errors.
- The app itself keeps working fully for manual use - the middleware's
  expired-402 branch frees manual writes.
- Briefs stop with a final farewell brief that says why (one send, not
  silence).

## Implementation map (ALL server-side - no store submission)

1. `src/middleware/subscriptionStatus.js` - expired households: allow
   manual writes; gate assistant/uploads/sync/brief routes.
2. `src/routes/whatsapp.js` - expiry gate stays; copy becomes the
   free-app framing. Same for the chat route's gate.
3. `src/routes/documents + calendar event attachments` - upload routes
   check premium; reads/downloads untouched.
4. Calendar connect routes + feed-sync jobs - new connections premium;
   existing feeds of lapsed households pause (not delete).
5. Brief jobs - skip lapsed households after one farewell send.
6. Postmark trial-expiry templates - copy to the new framing (manual).
7. Copy sweep (bundle-side, rides next regular build): Settings expired
   banners, TrialIndicator, onboarding paywall phase removed, landing
   pages. KNOWN STALE: the new marketing site prototype's hero still
   says "Free 30-day trial".
8. Rollout: single env flag (FREE_APP_MODE=1) flips 1-5 estate-wide, so
   the 30 currently-expired + all expiring households switch the moment
   it's on. Reversible by unsetting.

## Metrics that replace the paywall funnel

Trial→paid conversion, lapsed→paid reactivation, assistant usage in
trial (the habit the lapse monetises), upload/sync gate hits by lapsed
households (demand signals). The admin paywall-funnel panel gets
repurposed to this once the gates ship.

## v2 candidates (only if data asks)

- Outcome-meter taste for lapsed families ("the assistant did this one
  free - it misses you") if reactivation is weak.
- Shorter trial if habit-to-lapse is reliably formed inside a week.
- Storage cap instead of hard upload gate if support asks for it.
