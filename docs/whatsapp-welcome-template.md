# Twilio Content Template — pairing welcome

Submit this in Twilio Console → Messaging → Content Template Builder. Once
approved, set the Content SID on Railway as `TWILIO_TEMPLATE_WELCOME`.

## Why this has to be a template

There are two ways to pair, and they are not equivalent:

| Path | What the user does | 24-hour window |
|---|---|---|
| `CONNECT ABC123` | messages the bot | **open** — they just messaged us |
| OTP | types a 6-digit code into the app | **closed** — they've never messaged us |

A free-form WhatsApp message can only be sent inside an open window. A template
sent *by us* does not open one — only an inbound message from the user does. So
on the OTP path the welcome was being rejected by Twilio with error **63016**,
and the user was told nothing at all after pairing.

The welcome has to arrive the moment pairing succeeds, on both paths. Only a
template does that.

Until this SID is configured, `sendWelcome` falls back to free-form and logs a
warning: the CONNECT path keeps working exactly as it does today, and the OTP
path keeps failing exactly as it does today. Configuring the SID is a pure
improvement with no behaviour to roll back.

## Template

| Field | Value |
|---|---|
| Friendly name | `housemait_welcome_v1` |
| Language | `en_GB` |
| Category | **Utility** — confirms the user's own account is now connected to a service they just set up. Not Marketing: there is no promotion, offer, or invitation to buy. |
| Content type | Text |

### Body

```
Hey {{1}} 👋 Housemait here. You're linked.

Message me like you'd text a friend:

  🛒 "We need milk and eggs"
  📋 "Remind me to book the dentist"
  📅 "Sofia football Saturday 10am"

Reply /help any time.
```

### Sample value

| Variable | Sample |
|---|---|
| `{{1}}` | `Grant` |

## Rules this body already satisfies

These are the three things that got the evening-brief template rejected first
time round. Check them again if you ever edit this body:

1. **Variables appear in ascending order.** There's only `{{1}}`, so trivially.
2. **The body does not end with a variable.** It ends with "Reply /help any
   time." Meta rejects a body whose final character is a variable.
3. **No variable value is empty.** `buildWelcomeBody` falls back to `there`
   when a member has no name — Twilio rejects empty values with error 21656.

Note also that only the *variable value* is subject to the "no newlines, no 4+
consecutive spaces" restriction. The two-space indent on the example lines is
static body text and is fine.

## Keeping the code in step

`buildWelcomeBody()` in `src/services/whatsapp.js` holds the free-form fallback,
and it must stay byte-identical to the body above. If they drift, the two
pairing paths start saying different things depending on an env var — which is
exactly the class of bug that made this a single function in the first place.

`src/services/whatsapp.test.js` asserts the fallback body matches this document.

## After approval

1. Copy the Content SID (`HX…`, 32 hex chars).
2. Railway → `TWILIO_TEMPLATE_WELCOME` → paste → the service restarts.
3. Watch for `[WhatsApp] Sending template via REST API` with the new SID.
4. Test the real thing: pair a number via the **OTP** flow (type the code into
   the app). The welcome should arrive within a second or two. That's the path
   that was broken, so the CONNECT path is not a valid test of this fix.

If you see error **63018**, the template is still pending approval or the SID is
wrong for the recipient's region.
