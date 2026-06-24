# Google OAuth verification — Calendar scopes (reuse existing project)

Companion to `google-calendar-twoway-plan.md`. Everything here is done in the **existing** Housemait Google Cloud project (the one already used for Google sign‑in). No new account/project.

> ## ⚠️ SUBMIT NOW: `calendar.readonly` ONLY (2026‑06‑24)
>
> Phase 1 (inbound, read‑only) is **built, deployed, and live behind the
> allowlist**. Phase 2 (`calendar.app.created`, outbound writes) is **NOT built
> yet**. Google requires you to *demonstrate each requested scope in use* in the
> demo video — you cannot film a feature that doesn't exist. So:
>
> - **Request `calendar.readonly` ONLY.** On the OAuth consent screen, if
>   `calendar.app.created` is listed, **remove it** for this submission. Add it
>   back for a second (incremental) verification when Phase 2 ships.
> - **Privacy policy URL → `https://housemait.com/privacy.html`** (the
>   pre‑rendered static page; it carries the Limited Use disclosure in its
>   initial HTML, so it's robust for both human reviewers and headless checks).
>   `/privacy` (React route) also works now and carries the disclosure, but the
>   `.html` is the safer choice for the reviewer.
> - Use the **readonly‑only** scope justification (§B) and demo script (§C‑readonly).
>
> The full two‑scope content below is retained for the **Phase 2** verification
> round and should be ignored for the current submission.

Scopes (full plan — Phase 2 adds the second one):
- `https://www.googleapis.com/auth/calendar.readonly` — read the user's selected calendars (inbound, read‑only). **← the only scope to submit now.**
- `https://www.googleapis.com/auth/calendar.app.created` — create/manage events on **only** a secondary "Housemait" calendar the app creates (outbound). Cannot access the user's other calendars. **← Phase 2, not yet built; do not request this round.**

Both are **sensitive** (not restricted) → standard verification, **no CASA / paid security assessment**.

---

## A0. Readonly‑only submission — the exact current‑state checklist

1. **OAuth consent screen → scopes:** ensure `calendar.readonly` is added; **remove `calendar.app.created` if present.**
2. **Branding:** app name, user support email, logo, app homepage `https://housemait.com`, **privacy URL `https://housemait.com/privacy.html`**, authorized domain `housemait.com`.
3. **Confirm live before submitting:** open `https://housemait.com/privacy.html` and check the "5a. Google Calendar data & Limited Use" section is visible. (Verified live 2026‑06‑24.)
4. **Scope justification:** paste §B's `calendar.readonly` paragraph only.
5. **Demo video (~90s):** record the §C‑readonly script (no `app.created` shot).
6. **Publish:** Publishing status → Publish app → "Prepare for verification" → submit. Until approved: 100‑user cap + unverified‑app screen on the *calendar* consent (sign‑in unaffected, thanks to incremental consent + test users).

### §C‑readonly — demo video script (current submission)
1. Show `https://housemait.com` in the address bar — "Housemait, a shared family organiser."
2. Sign in → **Settings → Connect Calendars → Connect Google Calendar**.
3. **Google's real consent screen** showing the read‑only calendar permission — read it aloud, click **Allow**.
4. Show the picker → select a calendar → your existing Google events now appear inside Housemait's calendar (read‑only).
5. Show **Disconnect** — it revokes access and removes the imported events.

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

**Why your app needs each scope / how the data is used:**

> Housemait is a shared family organiser. Families keep their calendar, chores, lists and school dates in one shared place.
>
> **`calendar.readonly`** — After a household member explicitly taps "Connect Google Calendar" and grants consent, we read (read‑only) the specific calendars they choose, so their existing events appear inside the family's shared calendar view in Housemait. We never modify, create, or delete anything in the user's calendars with this scope. Data is fetched server‑side on a schedule and stored only to render the family calendar.
>
> **`calendar.app.created`** — With the user's consent we create one dedicated secondary calendar named "Housemait" in their Google account, and write the family events created inside Housemait into **only that calendar**, so the user can also see their family events in their own Google Calendar app. This scope, by Google's design, cannot read, modify, or delete the user's primary or any other calendar — it is limited to the calendar our app created. We chose it specifically so we can never touch a user's existing calendar data.
>
> We request these scopes **incrementally** (only at the moment the user connects a calendar, never at sign‑in), request the minimum necessary, and use the data solely to provide the calendar‑sync feature. Use of the data complies with the Google API Services User Data Policy, including the Limited Use requirements.

---

## C. Demo video — script & shot list

Record a screen capture (~2–3 min, unlisted YouTube). Google must see the **real OAuth consent screen** and each scope being used on your **production domain**.

1. **Identity (10s).** Show `https://housemait.com` in the address bar so the app matches the OAuth client. Brief voiceover: "Housemait, a shared family organiser."
2. **Start the flow (10s).** Sign in, go to **Settings → Connect Calendars**, tap **Connect Google Calendar**.
3. **Consent screen (15s) — REQUIRED.** Show Google's actual consent screen listing **both** scopes ("See events on all your calendars" / "make secondary calendars…"). Read them aloud, click **Allow**.
4. **`calendar.readonly` in use (30s).** Show the calendar picker, select a calendar, then show the user's existing Google events now appearing inside Housemait's calendar — read‑only.
5. **`calendar.app.created` in use (40s).** Create a family event in Housemait. Open Google Calendar and show it appears under the **"Housemait"** calendar. Explicitly point out it did **not** appear in / modify the primary calendar — demonstrating the scope only touches the app‑created calendar.
6. **Disconnect (15s).** Show disconnect: it revokes access and removes only the Housemait calendar.
7. **Voiceover throughout** naming each scope and why it's needed (mirror Section B).

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
