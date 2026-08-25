# WhatsApp resilience: compliance posture + eviction runbook

Written 2026-08-24 after Toki (competitor) was evicted from WhatsApp under
Meta's Business Solution Terms, which ban *standalone AI providers* -
companies whose product IS the assistant riding WhatsApp (ChatGPT's
WhatsApp bot went the same way). Housemait's position is structurally
different: a family-organiser app (iOS/Android/web) using the Business API
as one interface. That defence only holds if our positioning consistently
says so. Decision (founder, 2026-08-24): do NOT build a parallel SMS bot -
at 1,905 outbound messages/30d averaging 265 chars (3-4 SMS segments with
emoji), a daily brief alone costs £3.50-5/user/month in carrier fees
against a £5.99 subscription. Prepare, don't build.

## Part 1 - Compliance posture

### Framing rule (all copy, everywhere)

Housemait is an app **with an assistant you can message on WhatsApp** -
never "an AI assistant on WhatsApp". The assistant belongs to the app;
WhatsApp is a channel. Toki's public positioning was the opposite, and it
is the category Meta evicts.

### Repo findings (2026-08-24 audit)

| Surface | Current text | Risk | Suggested |
|---|---|---|---|
| Landing hero (LandingPage.jsx:610) | "with an AI assistant in WhatsApp that does it all for you" | HIGHEST - exact evicted-category phrasing, on the most public sentence | "with an assistant that does it all for you - just message it on WhatsApp" |
| Landing FAQ (LandingPage.jsx:91-96) | "app, with an assistant on WhatsApp" | Low - app-first framing, fine | keep |
| Expired-trial bot reply (whatsapp.js:98) | "me (your WhatsApp assistant)" | Low | "me (your Housemait assistant)" when next touched |
| Invite email (email.js) | "with a WhatsApp assistant that does the typing" | Medium - same possession pattern | "with an assistant on WhatsApp that does the typing" or "the Housemait assistant" |

Copy changes are the founder's call - this table is the recommendation,
nothing applied.

### Founder checklist (surfaces the repo can't see)

- [ ] **Twilio-registered WhatsApp templates** (Content SIDs in env:
      HOUSEHOLD_UPDATE, DAILY_REMINDER, VERIFICATION_CODE + any since):
      review the approved texts - they are submitted TO Meta and are the
      single most-reviewed surface. They should read as app notifications,
      not AI-assistant marketing.
- [ ] **WhatsApp Business profile** (Meta Business Manager via Twilio):
      display name "Housemait", category = productivity/app (NOT anything
      AI), description framed as the app's messaging channel.
- [ ] **Business verification** complete and matching the company entity.
- [ ] **Quality rating** (Business Manager): check it's High; set a
      calendar reminder to glance monthly. A sliding rating is the early
      warning most evicted businesses ignored.
- [ ] **App Store / Play descriptions**: same framing rule.

### Compliance strengths already in place (cite these if challenged)

- Real product independent of WhatsApp: native apps + web, calendar/lists/
  meals/chores all first-class without the bot.
- Opt-in pairing (user initiates), in-thread STOP honoured deterministically
  (pre-classifier - can't be missed by an LLM), per-category opt-outs.
- Template/24h-session discipline via decideSendPath (whatsapp-templates.js)
  - no free-form sends outside the session window.

## Part 2 - Eviction runbook (the 48-hour plan)

### Early-warning signals

Template approvals start getting rejected; quality rating drops; Twilio
compliance email; sudden spike in 63016/63018 send errors. Any of these →
run this playbook BEFORE hard cutoff.

### Hour 0-2: communicate

- One-off SMS blast to every linked number - `users.whatsapp_phone` where
  `whatsapp_linked` (same Twilio account can send SMS, possibly from the
  same number): "Housemait here - WhatsApp messaging is down for now.
  Everything still works in the app: [app link]. You can also email things
  to your house inbox." Single segment, no emoji. This is the ONLY bulk
  SMS ever planned; it needs no bot.
- Dashboard banner + push via the existing notification centre.

### Hour 2-48: degraded SMS mode (only if WhatsApp is gone for good)

The pipeline is channel-agnostic text-in/text-out; the work is a thin
adapter, not a rebuild:

1. New Twilio Programmable Messaging webhook → reuse the WhatsApp webhook
   handler (src/routes/whatsapp.js) with a channel flag; identify users by
   the same `getUserByWhatsAppPhone` (numbers are numbers).
2. Outbound seam: whatsapp.sendMessage grows an SMS path. Strip markdown
   (*bold*) and ALL emoji (emoji forces 70-char UCS-2 segments); hard-cap
   replies at 2 segments (~300 GSM chars).
3. Briefs OFF on SMS by default (cost); offer an opt-in 1-segment digest.
4. Media flows (voice notes, letter photos) reply "send it to your house
   inbox or open the app" - MMS is not viable in the UK.
5. Broadcasts route to push-first (already the default); SMS only for
   app-less members, 1 segment.

Estimated effort: ~2 days. Cost at current scale in degraded mode
(no briefs, capped replies): roughly £30-60/month - acceptable as a
bridge, not as the product.

### The channels that make this survivable (keep investing)

In-app AI chat (same pipeline), house email inbox, Siri shortcut, push
notification centre. Every WhatsApp capability needs a Meta-free sibling -
that list is the real insurance policy.

## Revisit triggers

- US launch planning → SMS/RCS becomes a MARKET decision (Ollie is
  SMS-native in the US), designed for cost from day one - not this runbook.
- Meta policy update touching "AI" definitions → re-run Part 1 checklist.
