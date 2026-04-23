# GDPR / Data protection copy — Phase 8

Draft text for the Terms of Service and Privacy Policy. Copy-paste into
the live `/privacy` and `/terms` pages (or the docs system that feeds
them). Written in plain English, UK-spelling, neutral-warm tone —
matches the rest of the Housemait voice.

**This is draft, not legal advice.** Before publishing, have a UK data-
protection solicitor sanity-check the wording against the ICO's latest
guidance. Three reasons:

1. **Lawful basis claims** — contract vs legitimate interests splits
   are nuanced and ICO guidance shifts.
2. **Sub-processor list** — you'll want to enumerate Stripe, Postmark,
   Supabase, Cloudflare R2, Anthropic, OpenAI, Google, Twilio etc., and
   confirm each has a current DPA in place.
3. **ROPA coverage** — you'll need a Record of Processing Activities
   document separate from the public Privacy Policy.

---

## Privacy Policy — new / updated sections

### Section X: How long we keep your data

We keep your household's data while your account is active. When your
trial ends or your subscription is cancelled, we keep your data for
**12 months** from the date you became inactive. During this window:

- You can resubscribe at any time and everything picks up exactly where
  you left off — lists, calendars, meals, tasks, family profiles, all of it.
- You can still log in to view your data in read-only mode.
- You can export your data to a JSON file from Settings → Data at any time.
- You can permanently delete your account and data from Settings →
  Delete account at any time.

After 12 months of inactivity, we permanently delete the household and
all data associated with it. We'll email you **30 days before
deletion** (at the 11-month mark) with a clear warning and a chance to
resubscribe or export.

Some records are kept longer where UK law requires us to:

- **Transaction records** (payments, refunds, invoices) — kept for
  **7 years** after the relevant tax year, per HMRC requirements.
  These are held by our payment processor (Stripe) and in our own
  financial records; they do not contain household content.
- **Deletion audit log** — we keep a minimal record of account
  deletions (user ID, email, deletion date, IP address, whether a
  Stripe subscription was cancelled) for **6 years**. This supports
  fraud-prevention and lets us respond to disputes such as "my
  account was deleted without my consent".

### Section X: Your rights

You have the following rights under the **UK General Data Protection
Regulation** and the **Data Protection Act 2018**:

- **Right of access** — see what data we hold about you. Settings →
  Export my data generates a JSON file containing every row we hold
  for your household.
- **Right to data portability** — take a machine-readable copy with
  you. The same JSON export covers this.
- **Right to rectification** — correct inaccurate data. Most fields
  are directly editable in the app; email us for anything that isn't.
- **Right to erasure ("right to be forgotten")** — delete your
  account. Settings → Delete my account removes all household data
  immediately. A minimal audit record is kept (see above) as permitted
  under Article 17(3) for compliance with legal obligations.
- **Right to restrict processing** — ask us to stop certain uses of
  your data (e.g. to pause AI classification).
- **Right to object** — specifically for any processing we base on
  legitimate interests, including marketing-adjacent email.
- **Right to complain** — you can lodge a complaint with the
  Information Commissioner's Office (ICO) at
  [ico.org.uk](https://ico.org.uk) or by calling 0303 123 1113.

We'll respond to any rights request within **one month** as required
by the UK GDPR. Email us at privacy@housemait.com.

### Section X: Email communications

We send two kinds of email:

1. **Transactional emails** — account-related and always sent:
   verification, password resets, household invites, welcome email,
   trial-ended notice, subscription receipts. You cannot opt out of
   these while you have an active account.
2. **Trial reminder emails** — sent at days 20, 25 and 28 of your
   30-day free trial. You can opt out in two ways:
   - Click the unsubscribe link in the email footer.
   - Settings → Plan → "Trial reminder emails" toggle.

We never sell or share your email with third parties.

### Section X: International transfers

Our infrastructure is hosted in the UK and EU. Some sub-processors
(e.g. Stripe, OpenAI, Anthropic, Google) process data outside the UK
under UK GDPR safeguards — typically the International Data Transfer
Addendum to the EU Standard Contractual Clauses. A current list of
sub-processors is at [housemait.com/subprocessors](https://housemait.com/subprocessors).

---

## Terms of Service — new / updated sections

### Section X: Data retention

If you cancel your subscription or your free trial ends without
subscribing, we'll keep your household's data for **12 months** so you
can pick up where you left off if you resubscribe. After 12 months of
inactivity, we permanently delete your household and all data within it.

We'll email you **30 days before deletion** with a clear warning and
your options (resubscribe or export).

You can delete your account and data at any time from Settings →
Delete account.

See the Privacy Policy for the full retention schedule and your rights
under UK data protection law.

### Section X: Account deletion

You can permanently delete your Housemait account at any time from
Settings → Delete account.

When you delete your account:

- If you are the **only member** of your household, the entire
  household is deleted — shopping lists, calendars, meals, tasks,
  family profiles, documents, chat history — all of it.
- If **other members remain**, only your user record is removed. Your
  name is blanked from shared items but the items themselves stay
  with the household. If you were the only admin, another member is
  automatically promoted.
- Any **active Stripe subscription** is cancelled immediately as part
  of the deletion. No further charges will be taken.
- A **minimal audit record** is kept (user ID, email, deletion date,
  IP address, Stripe status) for 6 years to support fraud prevention
  and dispute resolution, as permitted by UK GDPR Article 17(3).

Deletion is **permanent and cannot be undone**. If you want a copy of
your data before deleting, use Settings → Export my data first.

### Section X: Governing law

These Terms are governed by the laws of England and Wales. Any
disputes will be subject to the exclusive jurisdiction of the courts
of England and Wales.

---

## Appendix: wording for the in-app delete modal

Already live in `web/src/pages/Settings.jsx` — for copy review:

> **Delete your account?**
>
> This permanently deletes your Housemait account. If you're the only
> member of **{household name}**, the household and all its data will
> be deleted too.
>
> [ Your password input ]
>
> Type `DELETE` to confirm:
> [ Text input ]
>
> ☐ I understand this cannot be undone.
>
> [Cancel] [Delete account]
