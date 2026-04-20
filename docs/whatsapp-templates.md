# WhatsApp broadcast templates

## Why this exists

Meta enforces a **24-hour customer-service window** on every WhatsApp Business account. You can only send a **free-form** message to a user who has sent you a message in the last 24 hours. Outside that window, every send from Twilio fails with error `63016 – Outside the allowed window. Please use a Message Template.`

Before template support, that meant passive household members — people who read notifications but rarely reply — silently stopped receiving broadcasts after 24 hours. No warning on our side; the errors just went to Railway logs.

Now the broadcast code checks a `whatsapp_last_inbound_at` column on each user and routes sends down one of two paths:

- **Inside the 24h window** → `sendMessage` (free-form text, any content)
- **Outside the window** → `sendTemplate` with a pre-approved Twilio Content Template

Until the template is approved and its SID is configured, out-of-window sends are **skipped** (with a warning log) rather than attempted and failing.

## The template

We submit one single-variable utility template to Meta:

**Name:** `housemait_household_update`
**Category:** `UTILITY`
**Language:** `en` (or `en_GB` depending on Twilio Console options)

**Body:**

```
Housemait update

{{1}}

Reply here to manage your lists, tasks and calendar.
```

**Variable:**
- `{{1}}` — the full pre-formatted broadcast line (e.g. `✅ Grant completed: Book car service`)

**Why one template, not several**

Meta approves every template individually. A single generic-notification template covers every broadcast type (task added, event added, shopping checked off, etc.) because the payload is always the same shape: one formatted line of text. If we later want action-specific templates for richer formatting, we can add them as separate entries in `src/services/whatsapp-templates.js`.

**Why the "Reply here…" line**

Two reasons. First, it justifies the UTILITY category to Meta reviewers: this is a functional notification, not a marketing blast. Second, it nudges the recipient to reply — which re-opens their 24h window, so subsequent notifications can be free-form again.

## Registering the template

### Option A — Twilio Console (easiest)

1. Log in to Twilio Console.
2. Navigate to **Messaging → Content Template Builder → Create new**.
3. Pick the Messaging Service that owns your WhatsApp sender (the same one in `TWILIO_MESSAGING_SERVICE_SID`).
4. Choose template type **Text** and paste the body exactly as shown above, including the blank lines.
5. Set the friendly name to `housemait_household_update` and the language to match your market (usually `en_GB`).
6. Submit for WhatsApp approval.
7. Wait 1–3 business days for Meta to approve. You'll see the status change from `Pending` to `Approved` in the Console.
8. Copy the **Content SID** (starts with `HX`, 34 characters) from the approved template.

### Option B — Twilio Content API

```bash
curl -X POST https://content.twilio.com/v1/Content \
  -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN \
  -H "Content-Type: application/json" \
  -d '{
    "friendly_name": "housemait_household_update",
    "language": "en_GB",
    "variables": {"1": "default update"},
    "types": {
      "twilio/text": {
        "body": "Housemait update\n\n{{1}}\n\nReply here to manage your lists, tasks and calendar."
      }
    }
  }'
```

Then submit it for WhatsApp approval:

```bash
curl -X POST https://content.twilio.com/v1/Content/<ContentSid>/ApprovalRequests/whatsapp \
  -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN \
  -H "Content-Type: application/json" \
  -d '{
    "name": "housemait_household_update",
    "category": "UTILITY"
  }'
```

## Once approved — configure Railway

Set **one new env var** on Railway:

```
TWILIO_TEMPLATE_HOUSEHOLD_UPDATE=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Also make sure these three are already set (unchanged from before):

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...      # required — Content Templates belong to a Messaging Service
TWILIO_WHATSAPP_NUMBER=+...             # optional fallback for sendMessage when no MSID
```

**Content Templates require a Messaging Service**, not a raw `From` number. If `TWILIO_MESSAGING_SERVICE_SID` isn't set, `sendTemplate` logs a warning and falls back to `sendMessage` (which will then fail with 63016 for out-of-window recipients — same as before the change).

## Verifying it works

1. Ask a household member whose `whatsapp_last_inbound_at` is more than 24 hours ago (or null) to **stop replying to the bot** for 24+ hours. Lynn is the canonical test case.
2. Complete a task in the Housemait app.
3. Check Railway logs for the send path taken:
   - `[WhatsApp] Sending template via REST API: {"To":"whatsapp:+447…","ContentSid":"HX…","vars":["1"]}` → template path chosen ✅
   - `[WhatsApp] Template sent: SM... accepted` → Twilio accepted it
   - Within a minute, the recipient sees: *"Housemait update / ✅ Grant completed: … / Reply here to manage your lists, tasks and calendar."*
4. The recipient replies "hi" → `whatsapp_last_inbound_at` updates → subsequent broadcasts go the free-form route.

If instead you see `[broadcast] Skipped Lynn — window closed and TWILIO_TEMPLATE_HOUSEHOLD_UPDATE not configured`, the env var isn't set yet.

If you see `[WhatsApp] Template REST API error: {"code":63018, ...}`, the template is still pending approval or the SID is wrong. `63018` in particular means "template doesn't exist / not approved for this recipient's region".

## Per-category pricing (as of 2026-04)

Meta charges per **conversation**, not per message. A conversation is opened by a template and lasts 24 hours; within it, any follow-up free-form messages are free.

| Category | UK | US | Typical use |
|---|---|---|---|
| Utility | ~£0.012 | ~$0.015 | Transactional — this is us |
| Authentication | similar | similar | OTPs |
| Marketing | higher | higher | Promotions |
| User-initiated | FREE | FREE | Inside the 24h window |

For a household of four with one passive member receiving ~5 template-initiated conversations per week, that's ~£0.30/month — well under Meta's 1,000-conversation free tier per account.

## Rollback

If template sending causes problems (e.g. Meta revokes approval, a template typo), the fastest rollback is to **unset** `TWILIO_TEMPLATE_HOUSEHOLD_UPDATE` on Railway. The code will revert to the previous behaviour: free-form sends work inside the window, and out-of-window sends are skipped with a warning log. No code deploy needed.
