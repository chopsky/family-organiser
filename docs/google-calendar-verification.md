# Google OAuth verification — Calendar scopes (reuse existing project)

Companion to `google-calendar-twoway-plan.md`. Everything here is done in the **existing** Housemait Google Cloud project (the one already used for Google sign‑in). No new account/project.

> ## ⚠️ Verification is `calendar.readonly` ONLY (updated 2026‑06‑24)
>
> Both Phase 1 (inbound read‑only) and Phase 2 (`calendar.app.created` outbound
> writes) are now **built, deployed, and live** behind their flags. But only
> ONE scope needs verifying:
>
> - **`calendar.readonly` is SENSITIVE** → needs verification: justification
>   (§B), a demo video showing it in use (§C‑readonly), and the Limited‑Use
>   privacy policy. This is the whole submission.
> - **`calendar.app.created` is NON‑SENSITIVE** (Google's own classification —
>   it can only ever touch a calendar the app creates, so it can't reach the
>   user's existing data). It needs **NO verification, NO justification, NO demo**.
>   **Leave it on the consent screen** — it just works; do NOT remove it.
> - The form only asks you to justify `calendar.readonly`. That's expected.
> - **Privacy policy URL → `https://housemait.com/privacy.html`** (pre‑rendered
>   static page carrying the Limited Use disclosure in its initial HTML — robust
>   for human reviewers and headless checks). `/privacy` works too.
> - **Demo video:** show ONLY the read‑only flow (connect → events appear in
>   Housemait). You do NOT need to film the Housemait‑calendar‑in‑Google part —
>   `app.created` is non‑sensitive. The consent screen will still list both
>   permissions during the demo; that's fine, reviewers only need the sensitive
>   one demonstrated. Voiceover is optional — on‑screen captions work too.

Scopes:
- `https://www.googleapis.com/auth/calendar.readonly` — read the user's selected calendars (inbound, read‑only). **SENSITIVE → the scope being verified.**
- `https://www.googleapis.com/auth/calendar.app.created` — create/manage events on **only** a secondary "Housemait" calendar the app creates (outbound). Cannot access the user's other calendars. **NON‑SENSITIVE → no verification needed; leave it enabled.**

Only `calendar.readonly` is sensitive → standard verification, **no CASA / paid security assessment**.

---

## A0. Submission — the exact current‑state checklist

1. **OAuth consent screen → scopes:** ensure both `calendar.readonly` and `calendar.app.created` are added. **Keep `app.created` — it's non‑sensitive, needs no verification, and is harmless to request.** Only `calendar.readonly` is gated.
2. **Branding:** app name, user support email, logo, app homepage `https://housemait.com`, **privacy URL `https://housemait.com/privacy.html`**, authorized domain `housemait.com`.
3. **Confirm live before submitting:** open `https://housemait.com/privacy.html` and check the "5a. Google Calendar data & Limited Use" section is visible. (Verified live 2026‑06‑24.)
4. **Scope justification:** the form only asks for `calendar.readonly` — paste §B's readonly paragraph. (No justification field for `app.created`; it's non‑sensitive.)
5. **Demo video (~90s):** record the §C‑readonly script. It only needs to show the **read‑only** scope in use; you do NOT need to film the `app.created` (Housemait‑calendar‑in‑Google) part. Voiceover OR on‑screen captions — either is accepted.
6. **Publish:** Publishing status → Publish app → "Prepare for verification" → submit. Until approved: 100‑user cap + unverified‑app screen on the *calendar* consent (sign‑in unaffected, thanks to incremental consent + test users).

### §C‑readonly — demo video script (current submission)
1. Show `https://housemait.com` in the address bar — "Housemait, a shared family organiser."
2. Sign in → **Settings → Connect Calendars → Connect Google Calendar**.
3. **Google's real consent screen** — it lists both permissions (the read‑only one is what's being verified). Name the read‑only permission (spoken or captioned), click **Allow**.
4. Show the picker → select a calendar → your existing Google events now appear inside Housemait's calendar (read‑only). **This is the key shot** — it demonstrates `calendar.readonly` in use.
5. (optional) Show **Disconnect** — it revokes access and removes the imported events.

---

## A. Console setup (do these in order)

> The OAuth consent area is being renamed to **"Google Auth Platform"** in the new console — same settings, possibly under that menu.

**1. Enable the Calendar API**
- console.cloud.google.com → confirm the **Housemait** project is selected (top bar).
- *APIs & Services → Library* → search **"Google Calendar API"** → **Enable**. (Free tier; no billing needed.)

**2. Complete consent‑screen branding** (required to pass verification)
- *APIs & Services → OAuth consent screen* (or *Google Auth Platform → Branding*). Fill in:
  - App name: **Housemait**
  - User support email
  - **App logo** (square PNG, ≥120×120)
  - **App home page:** `https://housemait.com`
  - **Privacy policy:** `https://housemait.com/privacy`
  - Terms of service: `https://housemait.com/terms`
  - **Authorized domains:** `housemait.com`
  - Developer contact email

**3. Add the calendar scopes**
- *OAuth consent screen → Data access → Add or remove scopes → "Manually add scopes"* → paste both:
  ```
  https://www.googleapis.com/auth/calendar.readonly
  https://www.googleapis.com/auth/calendar.app.created
  ```
- Save.

**4. Add the redirect URI to the CALENDAR web client**
- We already have a dedicated web client for this: **"Family Organiser Calendar" (Web application)** = Railway `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` (backend reads these in `src/services/providers/google.js`). **Do NOT** use the sign‑in client (`GOOGLE_CLIENT_ID`) or the "Housemait iOS" client.
- *APIs & Services → Credentials* → open **"Family Organiser Calendar"**.
- (Sanity‑check: its Client ID should equal the `GOOGLE_CALENDAR_CLIENT_ID` value in Railway — both start `1094093123603-qim…`.)
- **Authorized redirect URI** (already present from the old sync — keep it; the code matches it exactly):
  ```
  https://api.housemait.com/api/calendar/connect/google/callback
  ```
- Save.

**5a. Build/dogfood NOW without verification (Testing mode)**
- *OAuth consent screen → Audience / Publishing status.* If status is **Testing**, add yourself + any test accounts under **Test users** (up to 100).
- Test users can grant the sensitive calendar scopes **with no warning and no verification** — enough to build Phase 1 and dogfood it. **Start here.**

**5b. Submit for verification (to launch to everyone)**
- When ready for the public: *Publishing status → Publish app* → "In production". Because of the sensitive scopes, Google prompts **"Prepare for verification."**
- Provide: the **scope justifications** (Section B), an **unlisted YouTube demo video** (Section C), confirm the privacy policy + homepage are live and reachable, and the authorized domains.
- Until approved: ~100‑user cap + an "unverified app" screen on the *calendar* consent (sign‑in is unaffected thanks to incremental consent).

---

## B. Scope justification (paste into the verification form)

The form only has a justification field for the **sensitive** scope, `calendar.readonly`. `calendar.app.created` is non‑sensitive → no field, nothing to write. Paste this (631 chars, under the 1000 limit):

> After a household member taps "Connect Google Calendar" and grants consent, Housemait reads (read-only) the specific calendars they select, so their existing events appear inside the family's shared calendar view. We never create, modify, or delete anything in the user's calendars with this scope, and never access calendars they did not choose. Data is fetched server-side on a schedule and stored only to render the family calendar. Our use of Google user data complies with the Google API Services User Data Policy, including the Limited Use requirements, and is never used for advertising, sold, or used to train AI/ML models.

If a justification for `calendar.app.created` is ever requested (it shouldn't be, given the non‑sensitive classification), use (672 chars):

> With the user's consent, Housemait creates one dedicated secondary calendar named "Housemait" in their Google account and writes the family events they create inside Housemait into only that calendar, so they can also see those events in their own Google Calendar. By design this scope cannot read, modify, or delete the user's primary or any other calendar — only the one our app created — so we can never touch their existing calendar data, which is exactly why we chose it. Our use of Google user data complies with the Google API Services User Data Policy, including the Limited Use requirements, and is never used for advertising, sold, or used to train AI/ML models.

---

## C. Demo video — script & shot list

Record a screen capture (~90s–2 min, unlisted YouTube). Google must see the **real OAuth consent screen** and the **sensitive** scope (`calendar.readonly`) being used on your **production domain**. `calendar.app.created` is non‑sensitive — step 5 below is **OPTIONAL** (include it only if you want to show the full feature; it's not required to pass). Voiceover OR on‑screen captions — either is accepted.

1. **Identity (10s).** Show `https://housemait.com` in the address bar so the app matches the OAuth client. "Housemait, a shared family organiser."
2. **Start the flow (10s).** Sign in, go to **Settings → Connect Calendars**, tap **Connect Google Calendar**.
3. **Consent screen (15s) — REQUIRED.** Show Google's actual consent screen (it lists both permissions; the read‑only one is what's being verified). Name the read‑only permission, click **Allow**.
4. **`calendar.readonly` in use (30s) — THE KEY SHOT.** Show the calendar picker, select a calendar, then show the user's existing Google events now appearing inside Housemait's calendar — read‑only.
5. **(OPTIONAL) `calendar.app.created` in use.** Create a family event in Housemait → show it appears under the **"Housemait"** calendar in Google and NOT in the primary. Skippable — non‑sensitive scope.
6. **(optional) Disconnect.** Show disconnect revoking access.

---

## D. Privacy policy — Limited Use snippet (add to /privacy)

Add a short section so verification passes (Google checks the policy is live and discloses this):

> **Google Calendar data.** If you choose to connect a Google Calendar, Housemait accesses your Google calendars with your consent: read‑only access to the calendars you select (to show their events in your family calendar), and the ability to manage events only on a dedicated "Housemait" calendar we create in your account (to add your family events). We do not access, change, or delete any of your other Google calendars. Housemait's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. You can disconnect at any time in Settings, which revokes our access.

---

## E. Quick checklist

- [ ] Calendar API enabled
- [ ] Consent‑screen branding complete (logo, homepage, privacy, terms, authorized domain)
- [ ] Both calendar scopes added
- [ ] Redirect URI added to the Web OAuth client
- [ ] /privacy updated with the Limited Use snippet
- [ ] Yourself added as a Test user → build + dogfood (no verification needed yet)
- [ ] Demo video recorded + uploaded (unlisted)
- [ ] Submit for verification when ready to launch publicly
