# Housemait — Claude Code Phase Prompts

This file contains the prompts for implementing the 30-day free trial and subscription system in Housemait. Each phase builds on the previous one — work through them in order, reviewing each phase before moving on.

The full specification is in `claude-code-instructions.md`. Save that file in your repo (e.g. as `docs/trial-implementation.md`) before starting Phase 1.

---

## General tips

- After each phase, do a manual smoke test before approving — Claude Code can write code that passes its own tests but doesn't quite work in your specific setup. Spend 10 minutes clicking through the actual app.
- If Claude Code suggests a different architecture than what's in the spec (e.g. "I think this should be in a different table"), consider letting it. Your existing codebase has constraints the spec doesn't know about.
- Phase 8 can be deferred until after launch if you want to ship faster — only the "Delete my account" feature is legally essential, and even that can be a manual support process for the first 50 users.

---

## Phase 1 — Database changes

> I'm implementing a 30-day free trial and subscription system for Housemait. The full specification is in `docs/trial-implementation.md` — please read that file first to understand the complete scope before we begin.
>
> We're going to implement this in phases. **Today we're only doing Phase 1: Database changes** (section 1 of the spec).
>
> Please do the following:
>
> 1. Read `docs/trial-implementation.md` in full so you understand how the database changes connect to the rest of the system.
> 2. Check our existing Supabase schema — look at the current `households` table (or `users` table if subscription state would live there instead) and tell me which one you think is the right place for these new columns. Explain your reasoning briefly.
> 3. Create a new Supabase migration file in the appropriate folder (e.g. `supabase/migrations/`). Use a timestamped filename following our existing naming convention.
> 4. The migration should:
>    - Add all the columns specified in section 1 of the spec (including `is_internal` and `trial_emails_enabled`)
>    - Create the `processed_stripe_events` table for webhook idempotency
>    - Update RLS policies so subscription fields are readable by household members but only writable by the service role
>    - Lock down `processed_stripe_events` to service role only
>    - Use `IF NOT EXISTS` clauses where appropriate so the migration is idempotent
> 5. Do NOT run the migration yet — I want to review it first.
> 6. After creating the migration, summarise what you've changed and flag anything you're unsure about or that doesn't match our existing patterns.
>
> Important: don't touch any backend code, frontend code, or Stripe configuration in this phase. We're keeping the scope tight to just the schema. Once I've reviewed and approved the migration, we'll move on to Phase 2 (backend trial middleware).

---

## Phase 2 — Backend trial middleware and status endpoint

> We're moving on to Phase 2 of the trial implementation. The spec is in `docs/trial-implementation.md` — refer back to section 2 for the details.
>
> Today we're building the backend trial status logic. Please do the following:
>
> 1. Re-read section 2 of the spec, plus section 7 (important implementation notes) for context.
> 2. Look at our existing Express middleware setup in `src/middleware/` (or wherever auth middleware lives) so the new code matches our patterns.
> 3. Create a new middleware file (e.g. `src/middleware/subscriptionStatus.js`) that:
>    - Loads the household record for the authenticated user
>    - **If `is_internal === true`, allows access immediately** (bypass all checks for testers and internal accounts)
>    - Returns 200 if status is `active`, or `trialing` with time remaining
>    - If `trialing` but `trial_ends_at` has passed, updates the status to `expired` using a **conditional UPDATE** (`WHERE id = ? AND subscription_status = 'trialing'`) to prevent race conditions, then returns 402
>    - If status is `expired` or `cancelled`, returns 402
>    - The 402 response body should include `{ status, trial_ended_at }` so the frontend can render the right UI
> 4. Wire the middleware into the existing route stack — apply it to all authenticated API routes EXCEPT the subscription endpoints themselves (otherwise expired users can't subscribe).
> 5. Create a new route `GET /api/subscription/status` that returns the household's current trial/subscription state without blocking. Make sure this route does NOT use the new middleware (it needs to be accessible to expired users).
> 6. Write basic unit tests for the middleware covering all five states: internal-bypass, trialing-active, trialing-expired-just-now, active, and expired. Include a test for the race condition (two simultaneous requests at moment of expiry should result in only one UPDATE affecting a row).
>
> Do NOT touch Stripe code, frontend code, or email logic in this phase. Just the middleware and the status endpoint.
>
> Once done, summarise the changes and flag anything that doesn't match our existing patterns.

---

## Phase 3 — Stripe checkout and webhook integration

> We're moving on to Phase 3 — Stripe integration. Refer to section 3 of `docs/trial-implementation.md`.
>
> Before we start, please confirm:
> 1. Is the `stripe` npm package already installed? If not, install it.
> 2. Have I added `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, and `STRIPE_PRICE_ANNUAL` to my `.env` file? If not, prompt me to do so before continuing.
>
> Once confirmed, please do the following:
>
> 1. Create a Stripe service module (e.g. `src/services/stripe.js`) that initialises the Stripe client and exports the helper functions we'll need.
> 2. Build the `POST /api/subscription/checkout` endpoint as specified in section 3. It should:
>    - Accept `{ plan: 'monthly' | 'annual' }` in the body
>    - Create a Stripe Checkout Session with the correct Price ID
>    - Use `mode: 'subscription'`, set `client_reference_id` to the household ID, pass the user's email, and enable promotion codes
>    - Return the checkout URL to the frontend
> 3. Build the `POST /api/webhooks/stripe` endpoint:
>    - Verify the webhook signature using `STRIPE_WEBHOOK_SECRET`
>    - **Implement idempotency:** at the start of the handler, check the `processed_stripe_events` table for the incoming `event.id`. If found, return 200 immediately. If not found, INSERT it and process the event — wrap the INSERT and the event processing in a database transaction.
>    - Handle `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, and `customer.subscription.updated`
>    - Update the household's subscription fields accordingly
>    - When setting `subscription_status = 'active'`, ignore any remaining trial time — active status overrides trial state for the rest of the household's lifecycle
>    - Return 200 quickly (don't do heavy processing inline — log and return)
>    - Important: this endpoint must use `express.raw()` for body parsing, NOT `express.json()`, otherwise signature verification will fail
>    - **Important: exclude this endpoint from any global auth middleware.** Stripe doesn't send auth headers; security comes from signature verification only.
> 4. Build the `POST /api/subscription/portal` endpoint that creates a Stripe Customer Portal session and returns the URL.
> 5. Write tests for the webhook handler that mock Stripe events for each of the five event types listed above. **Include a duplicate-event test** that sends the same event twice and verifies the second is a no-op.
> 6. Tell me what to set up in the Stripe Dashboard:
>    - The two Products and Prices I need to create
>    - The webhook endpoint URL to register and which events to subscribe to
>    - How to test webhooks locally with the Stripe CLI
>    - The test card numbers I should use for QA: `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (declined), `4000 0025 0000 3155` (3D Secure / UK SCA), `4000 0000 0000 0341` (renewal failure)
>
> Do NOT touch frontend code or email logic in this phase.
>
> Summarise the changes when done, and give me a clear checklist of what I need to do in the Stripe Dashboard before this can be tested.

---

## Phase 4 — Frontend subscription context and trial indicator

> We're moving on to Phase 4 — the frontend subscription context and the in-app trial indicator. Refer to section 4 of `docs/trial-implementation.md`.
>
> Please do the following:
>
> 1. Look at our existing React context setup (e.g. `web/src/contexts/`) so the new code matches our patterns. If we have an `AuthContext` already, decide whether to extend it or create a separate `SubscriptionContext`. Tell me your recommendation and reasoning before implementing.
> 2. Create the subscription context that:
>    - Fetches `GET /api/subscription/status` on app load
>    - Exposes `status`, `daysRemaining`, `plan`, and a `refresh()` method
>    - Refetches when the user navigates back to the app (e.g. after Stripe checkout completes)
> 3. Build the trial indicator component(s) following the day-by-day rules in section 4:
>    - Days 1–20: subtle text in the account/settings area only
>    - Days 21–25: dismissible card on the home/dashboard
>    - Days 26–30: non-dismissible card with personalised usage stats (e.g. "you've added X items, planned X meals")
>    - Use the Housemait brand colours (plum primary, coral accent) per our design system in `CLAUDE.md` and the `/design` folder
> 4. For the day 26–30 indicator, create a backend endpoint (e.g. `GET /api/household/usage-summary`) that returns the stats needed (item count, meal count, etc.). Keep the query efficient — use a single SQL query with COUNTs.
> 5. The dismissible state should persist for that day only — i.e. if a user dismisses the card on day 22, it should reappear on day 23. Store the dismissed day in localStorage.
>
> Do NOT build the subscribe page or the read-only expired state in this phase — they're coming in phases 5 and 6.
>
> Summarise the changes when done.

---

## Phase 5 — Subscribe page and 402 handling

> We're moving on to Phase 5 — the subscribe page and global 402 handling. Refer to sections 4 and 7 of `docs/trial-implementation.md`.
>
> Please do the following:
>
> 1. Build a subscribe page (e.g. `web/src/pages/Subscribe.jsx`) that:
>    - Shows two pricing cards: Monthly (£4.99/month) and Annual (£49/year)
>    - Highlights Annual as "Best value" with the savings clearly shown ("Save £10.88" or "2 months free")
>    - Pre-selects the Annual option
>    - Each "Subscribe" button calls `POST /api/subscription/checkout` with the selected plan and redirects to the returned Stripe URL
>    - Uses the Housemait brand system from `CLAUDE.md`
> 2. Build a `/subscription/success` page that shows a confirmation, calls `subscription.refresh()` to update the context, and redirects to the dashboard after 3 seconds.
> 3. Build a `/subscription/cancel` page with a friendly "no worries" message and a link back to the dashboard.
> 4. Add a global Axios (or fetch wrapper) interceptor that catches 402 responses and triggers the subscribe modal/redirect. Make sure it doesn't trigger on the subscription endpoints themselves to avoid loops.
> 5. Build a "Manage subscription" button in Settings that calls `POST /api/subscription/portal` and redirects to the Stripe Customer Portal. Only show this button if the user is `active`.
>
> Do NOT build the read-only expired state yet — that's Phase 6.
>
> Summarise the changes when done, including any UX decisions you made.

---

## Phase 6 — Read-only expired state

> We're moving on to Phase 6 — the read-only expired state. Refer to section 8 of `docs/trial-implementation.md`.
>
> Please do the following:
>
> 1. Build a reusable `<SubscribePrompt />` component that can wrap or replace any interactive element. It should:
>    - Show a small inline message: "Subscribe to unlock this feature"
>    - Include a "Subscribe" CTA that navigates to the subscribe page
>    - Match our design system (plum/coral)
> 2. Build a non-dismissible "Trial ended" overlay that appears on first login after expiry:
>    - Headline: "Your free trial has ended"
>    - Pull household summary stats (X lists, X meals, X family members) from the usage endpoint we built in Phase 4
>    - Reassurance: "Your data is safe — subscribe anytime to pick up right where you left off"
>    - Two CTAs: "Subscribe" (primary) and "Just browsing" (secondary text link)
> 3. Apply read-only behaviour across the app for expired users. For each interactive surface listed in section 8 of the spec (shopping lists, calendar, meals, tasks, receipt scanning, family members, settings), disable the interactive controls and show the SubscribePrompt component appropriately.
>    - Use the subscription context to check status, don't make this decision per-component
>    - The simplest pattern is a small `useCanWrite()` hook that returns `subscription.status === 'active' || subscription.status === 'trialing'`
> 4. For the WhatsApp bot: update the bot's response handler so that when it receives a message from an expired household, it replies with: "Your Housemait trial has ended. Subscribe at housemait.com to keep using me!"
> 5. Make sure Settings remains fully accessible — the user needs to be able to reach the subscribe page and view their account info even when expired.
>
> Test by manually setting a household's `trial_ends_at` to a past date in the database and walking through the app.
>
> Summarise the changes when done.

---

## Phase 7 — SendGrid welcome email and trial nudge emails

> We're moving on to Phase 7 — the email system. Refer to sections 5 and 6 of `docs/trial-implementation.md`.
>
> Before we start, please confirm:
> 1. Is SendGrid already integrated? If so, where does it live?
> 2. Is `SENDGRID_API_KEY` in the `.env` file?
>
> Once confirmed, please do the following:
>
> 1. The full welcome email copy is in `welcome-email.docx` (which I'll provide separately or paste in). Set up the welcome email as a SendGrid Dynamic Template. Tell me exactly what to paste into the SendGrid template editor and which template variables to configure (`{{first_name}}`, `{{trial_end_date}}`, `{{app_url}}`).
> 2. Trigger the welcome email immediately after a successful signup. Hook it into the existing signup flow.
> 3. Build a scheduled job system. We're using Railway, so use Railway's cron feature (or `node-cron` if simpler). The job should run once daily at a sensible time (e.g. 9am UK time).
> 4. The cron job should query the households table for users at specific trial days and send the appropriate nudge email:
>    - Day 20: gentle reminder
>    - Day 25: stronger nudge
>    - Day 28: final push
>    - Day 30: trial expired notification
> 5. For each email, only send if `subscription_status` is still `'trialing'` (or `'expired'` for the day 30 email). For the nudge emails (days 20, 25, 28), also check `trial_emails_enabled = TRUE` — skip if the user has opted out. The welcome email (day 1) and final expiry email (day 30) always send regardless of preference. Track sent emails in a new table (e.g. `sent_emails` with household_id, email_type, sent_at) to prevent duplicates if the cron runs more than once.
> 6. Draft the copy for each of the four nudge emails following the guidance in section 6. Use the same tone and brand voice as the welcome email. Include personalised usage stats where it makes sense. **All dates in emails must be formatted in Europe/London time** using `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' })`.
> 7. Set up each one as a SendGrid Dynamic Template and tell me what to paste into the SendGrid editor.
> 8. **Build the unsubscribe flow:**
>    - Each nudge email footer includes a one-click unsubscribe link: `https://housemait.com/unsubscribe?token=...`
>    - The token is a signed JWT or HMAC containing the household ID, signed with `UNSUBSCRIBE_TOKEN_SECRET`
>    - Build `GET /api/unsubscribe?token=...` that verifies the token, sets `trial_emails_enabled = FALSE` on the household, and shows a simple confirmation page
>    - Add a "Send me trial reminder emails" toggle in Settings that lets users re-enable or disable the preference at any time
>
> Test the cron job locally by manually triggering it with a test household at the right trial day.
>
> Summarise the changes when done, and give me a clear checklist of what I need to set up in SendGrid.

---

## Phase 8 — Data retention policy and GDPR essentials

> We're moving on to Phase 8 — data retention and GDPR. Refer to section 9 of `docs/trial-implementation.md`.
>
> Important: per the spec, we are NOT building the cleanup job yet — it's not needed for 12 months after launch. We're only building the foundations and the GDPR-required user-facing features.
>
> Please do the following:
>
> 1. Add the `inactive_since` column to the households table via a new Supabase migration. Don't run it yet — let me review.
> 2. Update the Stripe webhook handler (from Phase 3) to set `inactive_since` when a subscription is cancelled and the current period ends. Set it to `subscription_current_period_end`.
> 3. Update the trial expiry logic (from Phase 2) to set `inactive_since` to `trial_ends_at` when a trial expires.
> 4. Update the subscription/checkout flow to clear `inactive_since` (set to NULL) when a user subscribes or resubscribes.
> 5. Build a "Delete my account" feature in Settings:
>    - Confirmation modal warning the action is permanent
>    - Requires the user to type "DELETE" to confirm
>    - On confirmation, calls `DELETE /api/household` which removes all household data (lists, meals, calendar, family members, etc.) and the auth user
>    - Cancels any active Stripe subscription as part of the deletion
>    - Logs the deletion for audit purposes
> 6. Build a "Download my data" feature in Settings (GDPR data portability):
>    - Generates a JSON file containing all the household's data
>    - Downloads to the user's device
>    - Doesn't need to be pretty — just complete
> 7. Draft text for the Terms of Service and Privacy Policy that I can use:
>    - Data retention: 12 months after trial/subscription expiry
>    - User rights to access, export, and delete their data
>    - Pre-deletion warning at 11 months
>    - Reference UK GDPR / Data Protection Act 2018
>
> Do NOT build the cleanup cron job or the 11-month warning email yet. Add a TODO comment in the codebase referencing where these should go when needed.
>
> Summarise the changes when done.
