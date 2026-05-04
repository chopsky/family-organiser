# Housemait — 30-Day Free Trial Implementation

## Overview

Implement a 30-day free trial system for Housemait. Every new user gets full access to all features for 30 days from signup. No credit card is required at signup. After 30 days, the user is prompted to subscribe (£5.99/month or £59.99/year) to continue using the app.

There is no "Pro" tier or separate plan name — users simply have either an active trial, an active subscription, or an expired/inactive state.

---

## 1. Database changes (Supabase / PostgreSQL)

Add the following columns to the existing users or households table (whichever manages the subscription state):

```sql
ALTER TABLE households ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE households ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days');
ALTER TABLE households ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trialing'
  CHECK (subscription_status IN ('trialing', 'active', 'expired', 'cancelled'));
ALTER TABLE households ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE households ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE households ADD COLUMN IF NOT EXISTS subscription_plan TEXT
  CHECK (subscription_plan IN ('monthly', 'annual'));
ALTER TABLE households ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ;

-- Internal/beta accounts that bypass all subscription checks (you, family, testers)
ALTER TABLE households ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT FALSE;

-- User preference for receiving trial nudge emails (welcome and final expiry always send)
ALTER TABLE households ADD COLUMN IF NOT EXISTS trial_emails_enabled BOOLEAN DEFAULT TRUE;
```

Also create a separate table for Stripe webhook idempotency:

```sql
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cleanup old processed events after 30 days (Stripe doesn't replay events older than this)
CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_processed_at
  ON processed_stripe_events(processed_at);
```

Update RLS policies so that subscription_status and trial fields are readable by household members but only writable by the backend (service role). The `processed_stripe_events` table should only be accessible to the service role.

---

## 2. Backend logic (Node.js / Express)

### Trial status check middleware

Create middleware that checks the user's trial/subscription status on every authenticated request. Add it after the auth middleware.

```
// Pseudocode for the middleware logic:
1. Get the household record for the authenticated user
2. If is_internal === true → allow access (internal/beta accounts bypass all checks)
3. If subscription_status === 'active' → allow access (subscribed user)
4. If subscription_status === 'trialing' AND NOW() < trial_ends_at → allow access (still in trial)
5. If subscription_status === 'trialing' AND NOW() >= trial_ends_at:
   → Update with conditional WHERE: UPDATE households SET subscription_status = 'expired'
     WHERE id = ? AND subscription_status = 'trialing'
   → Return 402 with { status: 'trial_expired', trial_ended_at: trial_ends_at }
6. If subscription_status === 'expired' or 'cancelled' → return 402 with { status: 'expired' }
```

**Important — race condition prevention:** When transitioning a trial to expired (step 5), use a conditional UPDATE that includes `WHERE subscription_status = 'trialing'`. This prevents two simultaneous requests from both attempting the update. If two requests hit at the exact moment of expiry, only one will modify the row — the second's UPDATE will affect zero rows, which is fine.

The 402 response should include enough info for the frontend to show the upgrade prompt. Do NOT block the entire app — the frontend should handle the 402 gracefully and show a subscribe modal/page rather than a hard wall.

### Trial info endpoint

```
GET /api/subscription/status
```

Returns:
```json
{
  "status": "trialing",
  "trial_ends_at": "2026-05-21T00:00:00Z",
  "days_remaining": 27,
  "subscription_plan": null
}
```

This endpoint powers the in-app trial indicator and email nudges.

---

## 3. Stripe integration

### Setup

Install Stripe: `npm install stripe`

Use Stripe in test mode during development. You'll need:
- STRIPE_SECRET_KEY (env var)
- STRIPE_WEBHOOK_SECRET (env var)
- Two Price IDs — one for monthly (£5.99) and one for annual (£59.99/year)

Create these products/prices in the Stripe dashboard or via the API.

### Checkout endpoint

```
POST /api/subscription/checkout
Body: { plan: 'monthly' | 'annual' }
```

Creates a Stripe Checkout Session and returns the URL. The frontend redirects the user to Stripe's hosted checkout. Set:
- mode: 'subscription'
- success_url: housemait.com/subscription/success?session_id={CHECKOUT_SESSION_ID}
- cancel_url: housemait.com/subscription/cancel
- client_reference_id: household ID
- customer_email: user's email
- Allow promotion codes (for future discount campaigns)

**Mid-trial subscription handling:** When a user subscribes during their trial (e.g. on day 12), do NOT pass Stripe a trial period. Their billing starts immediately. The trade-off is they "lose" their remaining trial days, but this keeps the implementation simple and avoids needing to credit unused days. When the webhook confirms the subscription is active, set `subscription_status = 'active'` and ignore the trial fields from that point forward — the active status takes precedence over any remaining trial time.

### Webhook handler

```
POST /api/webhooks/stripe
```

**Critical: idempotency.** Stripe occasionally sends the same event twice (network retries, dashboard "resend" actions, etc.). Without deduplication, you could extend a subscription period twice, send duplicate confirmation emails, or corrupt state. At the very start of the handler, check the `processed_stripe_events` table:

```
1. Receive event, verify signature
2. SELECT 1 FROM processed_stripe_events WHERE event_id = event.id
3. If found → return 200 immediately, do nothing else
4. If not found → INSERT into processed_stripe_events, then process the event
5. Wrap steps 4 and the event processing in a transaction so they succeed or fail together
```

Handle these events:
- **checkout.session.completed** → Set subscription_status = 'active', store stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_current_period_end
- **invoice.paid** → Update subscription_current_period_end (handles renewals)
- **invoice.payment_failed** → Optionally flag the account, send a notification
- **customer.subscription.deleted** → Set subscription_status = 'cancelled'
- **customer.subscription.updated** → Update plan/period info

Verify webhook signatures using STRIPE_WEBHOOK_SECRET.

**Endpoint security note:** The Stripe webhook URL must be publicly accessible (Railway handles this automatically). The endpoint itself is secured by Stripe's signature verification, NOT by your normal auth middleware. If your Express app applies auth middleware globally, exclude the webhook route — otherwise Stripe's requests will be rejected.

### Customer portal

```
POST /api/subscription/portal
```

Creates a Stripe Customer Portal session so users can manage their subscription (cancel, update card, switch plans). Returns the portal URL.

### Stripe test cards (for QA)

Use these test card numbers in Stripe test mode:
- `4242 4242 4242 4242` — successful payment (any CVC, any future expiry)
- `4000 0000 0000 9995` — declined (insufficient funds)
- `4000 0025 0000 3155` — requires 3D Secure authentication (UK SCA testing)
- `4000 0000 0000 0341` — successful payment but fails on subscription renewal (good for testing invoice.payment_failed)

Full list at stripe.com/docs/testing.

---

## 4. Frontend changes (React)

### Subscription context

Create a SubscriptionContext (or add to the existing auth context) that provides:
- status: 'trialing' | 'active' | 'expired' | 'cancelled'
- daysRemaining: number (null if not trialing)
- plan: 'monthly' | 'annual' | null

Fetch from GET /api/subscription/status on app load.

### Trial indicator

Display a subtle, non-intrusive indicator in the app:
- **Days 1–20:** Small text in the account/settings area only. Something like "Free trial · 24 days left". Use the Housemait brand colours (plum text). Do NOT show a banner or countdown on the main screens.
- **Days 21–25:** Show a dismissible card on the home/dashboard screen: "Your free trial ends in X days. Subscribe to keep all your features." With a "Subscribe" button linking to the pricing/checkout page.
- **Days 26–30:** Make the card non-dismissible and slightly more prominent. Copy becomes more specific: "Your trial ends on [date]. You've [scanned X receipts / planned X meals / added X items] — subscribe to keep going." Pull actual usage stats from the database.
- **After expiry:** The app enters a read-only expired state (see section 8 below).

### Subscribe page / modal

Show two pricing cards:
- Monthly: £5.99/month
- Annual: £59.99/year (save £11.89 — or "2 months free")

Highlight annual as "Most popular" or "Best value". Each card has a "Subscribe" button that calls POST /api/subscription/checkout with the selected plan, then redirects to the Stripe Checkout URL.

### Handle 402 responses

Add a global Axios/fetch interceptor that catches 402 responses from the API. When received, show the subscribe modal rather than an error screen. The app should degrade gracefully — don't crash or show a blank page.

---

## 5. Welcome email (SendGrid)

Trigger on new user signup. Use SendGrid's dynamic template system.

**Template variables:**
- {{first_name}} — from the signup form
- {{trial_end_date}} — formatted as "21 May 2026"
- {{app_url}} — link to housemait.com or a deep link

**Subject:** Welcome to Housemait! Your 30-day free trial starts now 🏠

See the attached welcome-email.docx for the full email copy to use as the SendGrid template content.

---

## 6. Trial nudge emails

Set up scheduled jobs (cron via Railway or a simple setInterval) to send nudge emails:

### Day 20 — Gentle reminder
- **Subject:** You've got 10 days left on your Housemait trial
- **Content:** Remind them what they've been using. Include usage stats if possible (e.g., "You've added X items to your shopping lists"). Mention the subscribe option. Keep it friendly and low-pressure.

### Day 25 — Stronger nudge
- **Subject:** 5 days left — don't lose your Housemait features
- **Content:** More specific about what happens when the trial ends. Highlight the annual plan savings. Include a direct link to the subscribe page.

### Day 28 — Final push
- **Subject:** Your Housemait trial ends in 2 days
- **Content:** Urgency without being pushy. "Your trial ends on [date]. Subscribe now to keep everything running smoothly for your family." Direct CTA button to checkout.

### Day 30 — Trial expired
- **Subject:** Your Housemait trial has ended
- **Content:** "We hope you enjoyed Housemait. Your trial has ended, but your data is still safe. Subscribe anytime to pick up where you left off." Reassure them nothing is deleted.

For each email, query the households table for users matching the right trial day, and only send if subscription_status is still 'trialing'.

### Email preferences and unsubscribe

The nudge emails (days 20, 25, 28) are marketing-adjacent and should respect a user preference. The welcome email (day 1) and final expiry email (day 30) are transactional and always send.

- **In Settings**, add a toggle: "Send me trial reminder emails" (controls the `trial_emails_enabled` field on the household record, default `TRUE`).
- **In each nudge email**, include an unsubscribe link in the footer that flips this preference to `FALSE`. The link should work without requiring login (use a signed token in the URL).
- **Cron job logic**: skip households where `trial_emails_enabled = FALSE` for days 20, 25, and 28. Always send for days 1 and 30.

This isn't strictly required under UK GDPR/PECR for transactional emails, but it's good practice and reduces spam complaints.

### Date formatting and timezones

All user-facing dates (in emails, in the app, in trial indicators) should be formatted in **Europe/London time** since your audience is UK-based. Use `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ... })` for formatting. Database storage stays in UTC (TIMESTAMPTZ handles this automatically).

Example: `trial_ends_at` stored as `2026-05-21T00:00:00Z` should display as "21 May 2026" in emails and the app.

---

## 7. Important implementation notes

- **Never delete user data on trial expiry.** The household's data (lists, calendars, meals, etc.) should persist indefinitely (subject to the data retention policy in section 9). This is both good UX and a strong conversion lever.
- **Trial is per household, not per user.** When one member of a household signs up and starts a trial, all family members share that same trial period.
- **Only one trial per household.** Prevent abuse by checking if a household has ever had trial_started_at set. Don't allow resetting the trial.
- **Internal/beta accounts bypass everything.** Households with `is_internal = TRUE` skip all subscription checks. Use this for your own account, family, friends, and testers — anyone who needs permanent free access. Manually set this in the database or via a Supabase admin function. Do NOT expose this as a user-facing setting.
- **Mid-trial subscriptions start billing immediately.** Don't pass a Stripe trial period — keep the implementation simple. Active subscription status overrides any remaining trial time.
- **Always use Europe/London for user-facing dates.** Database stays in UTC; format on display.
- **Stripe webhooks must be idempotent.** Use the `processed_stripe_events` table to dedupe.
- **Annual pricing is the priority.** On the subscribe page, pre-select or highlight the annual plan. Show the savings clearly (e.g., "Save £10.88" or "2 months free").
- **Stripe test mode first.** Build and test everything in Stripe test mode. Use Stripe CLI for webhook testing locally.
- **Environment variables needed:**
  - STRIPE_SECRET_KEY
  - STRIPE_PUBLISHABLE_KEY
  - STRIPE_WEBHOOK_SECRET
  - STRIPE_PRICE_MONTHLY (Price ID for £5.99/month)
  - STRIPE_PRICE_ANNUAL (Price ID for £59.99/year)
  - SENDGRID_API_KEY
  - UNSUBSCRIBE_TOKEN_SECRET (for signing one-click unsubscribe links)

---

## 8. Expired trial — read-only state

When a user's trial expires and they haven't subscribed, the app should NOT lock them out entirely or show a blank page. Instead, it enters a read-only state that lets them see their data but not interact with it. The goal is to remind them of the value they've already built up, making the decision to subscribe feel like continuing — not starting over.

### What the user sees

On login, show a **non-dismissible overlay/modal** on the home screen with:
- A headline: "Your free trial has ended"
- A summary of their household's data, pulled from the database. For example:
  - "You've got X shopping lists, X meals saved, and your school calendar synced"
  - "Your family of X is set up and ready to go"
- Reassurance: "Your data is safe — subscribe anytime to pick up right where you left off."
- Two CTA buttons:
  - **"Subscribe"** (primary, prominent) → goes to the subscribe page / Stripe checkout
  - **"Just browsing"** (secondary, muted text link) → dismisses the modal and shows the read-only app

### Read-only behaviour

When the modal is dismissed and the user browses in read-only mode:

- **Shopping lists:** Visible but cannot add, edit, or delete items. "Add item" input is disabled/greyed out with a subtle "Subscribe to add items" tooltip or label.
- **Calendar:** Visible, can browse dates, but cannot create or edit events. The "Add event" button shows the subscribe prompt.
- **Meal plans:** Visible but cannot create new plans, edit meals, or generate shopping lists from them.
- **Tasks:** Visible but cannot create, complete, or edit tasks.
- **WhatsApp bot:** Responds with a friendly message: "Your Housemait trial has ended. Subscribe at housemait.com to keep using me!"
- **Receipt scanning:** Disabled. Camera/upload button shows subscribe prompt.
- **Family members:** Visible but cannot invite new members or edit profiles.
- **Settings:** Accessible (so they can reach the subscribe page and manage their account), but cannot change household settings.

### Implementation approach

The simplest approach is a frontend-level check. Wrap interactive components (buttons, inputs, forms) with a check against the subscription context:

```
// Pseudocode
if (subscription.status === 'expired') {
  show subscribe prompt instead of performing the action
} else {
  perform the action normally
}
```

The backend 402 middleware already blocks API writes, so even if someone bypasses the frontend, the API won't process mutations for expired households. The frontend read-only state is primarily a UX layer on top of that.

### Subscribe prompt component

Create a reusable component (e.g., `<SubscribePrompt />`) that can be dropped into any interactive element. When triggered, it shows a small inline message or mini-modal:
- "Subscribe to unlock this feature"
- "Monthly: £5.99/mo · Annual: £59.99/year (save £11.89)"
- CTA button → Stripe checkout

This keeps the subscribe option ever-present without being aggressive.

---

## 9. Data retention policy

### Policy

User data is retained for **12 months** after a trial or subscription expires. After 12 months of inactivity (no login, no subscription), the household's data may be permanently deleted.

This needs to be stated in Housemait's Terms of Service and Privacy Policy.

### Database changes

Add a column to track when the account became inactive:

```sql
ALTER TABLE households ADD COLUMN IF NOT EXISTS inactive_since TIMESTAMPTZ;
```

Set `inactive_since` when:
- A trial expires without subscribing (set to trial_ends_at)
- A subscription is cancelled and the current period ends (set to subscription_current_period_end)

Clear `inactive_since` (set to NULL) when:
- The user subscribes or resubscribes

### Scheduled cleanup job

Build a scheduled job (cron, Railway cron, or a daily setInterval) that runs once per day:

```
// Pseudocode
1. Query households WHERE inactive_since IS NOT NULL AND inactive_since < NOW() - INTERVAL '12 months'
2. For each matching household:
   a. Delete all shopping lists, items, meals, calendar events, tasks, receipts, and any other user-generated content
   b. Delete all family member profiles
   c. Delete the household record itself
   d. Delete the associated Supabase auth users (or mark them as deleted)
   e. Log the deletion for audit purposes
3. Send a final "Your data has been deleted" email 30 days BEFORE deletion (i.e., at the 11-month mark) giving them one last chance to subscribe and retain their data
```

### Pre-deletion warning email (Month 11)

Set up an additional scheduled job that sends a warning email at the 11-month mark:

- **Subject:** Your Housemait data will be deleted in 30 days
- **Content:** "It's been a while since you used Housemait. Your household data (shopping lists, calendars, meal plans, and more) will be permanently deleted on [date]. Subscribe now to keep everything safe, or log in to export your data."
- Include a direct subscribe CTA and a link to log in.

### Important notes

- **Do NOT build the cleanup job immediately.** It's not needed until 12 months after your first users sign up. Focus on launch first. Just have the policy written into your Terms of Service and Privacy Policy now.
- **GDPR compliance:** Users can request their data be deleted sooner under their right to erasure (Article 17). Build a "Delete my account" option in Settings that triggers immediate deletion of all household data. This is a legal requirement under UK GDPR.
- **Data export:** Consider offering a "Download my data" option in Settings (GDPR right to data portability, Article 20). This can be a simple JSON or CSV export of their lists, meals, and calendar events. Not essential for launch but good to have on the roadmap.

