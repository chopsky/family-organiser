# Disaster recovery — Housemait

The runbook for "the database is gone, what do I do" and the setup
steps for the off-site backup pipeline that prevents that question from
becoming an emergency.

---

## What's backed up (and what isn't)

### In scope — daily

The `public` schema of the production Postgres database, encrypted and
shipped to Cloudflare R2 every day at 03:00 UTC. This includes:

- All household data: `users`, `households`, `calendar_events`, `tasks`,
  `shopping_items`, `shopping_lists`, `meals`, `recipes`, `documents`
  metadata (file pointers — see "out of scope" below for actual files),
  `notes`, `whatsapp_messages`, etc.
- Audit logs: `document_access_log`, refresh tokens, etc.
- All migrations applied to the schema as of dump time.

### Out of scope — backed up separately or not at all

| Surface | Where it lives | Backup strategy |
|---|---|---|
| Document files (PDFs/images) | Cloudflare R2 (`housemait-documents` bucket) | Already off-Supabase; R2 has its own redundancy. Could enable R2 cross-region replication later if paranoid. |
| Supabase Auth users | Supabase-managed `auth.users` schema | Recoverable: each user is also in `public.users` with their email. On a fresh project, send everyone a password-reset link. |
| Supabase Storage objects | Supabase Storage (we don't actively use it — files go to R2) | N/A |
| Postmark templates | Postmark dashboard | Source of truth: `docs/email-templates.md` in this repo. |
| Vercel env vars | Vercel dashboard | Manual; written down in 1Password. |
| Railway env vars | Railway dashboard | Manual; written down in 1Password. |
| Stripe products/prices | Stripe dashboard | Manual; written down in 1Password. |
| iOS App Store builds | Apple App Store Connect | Apple's responsibility. Source code in this repo. |

The principle: data that's been earned through user activity gets
backed up; configuration that's been set up once gets documented.

---

## Where backups live

- **Bucket**: `housemait-backups` (Cloudflare R2, EU jurisdiction)
- **Key format**: `daily/housemait-<ISO8601 timestamp>.sql.gz.gpg`
- **Encryption**: GPG asymmetric, encrypted to Grant's public key.
  Decryption requires the private key, which lives in:
    - 1Password (primary)
    - A printed paper copy in a safe (cold-storage backup of the key)
  The CI runner never sees the private key.
- **Retention** (R2 lifecycle policy):
    - Daily backups kept for **7 days** (`daily/` prefix, expire 7d)
    - Weekly snapshots — Sunday's daily backup kept for **4 weeks**
    - Monthly snapshots — 1st of month's daily backup kept for **12 months**

---

## One-time setup checklist

When standing up backups for the first time. Each step is independent;
the workflow won't run successfully until all of them are complete.

### 1. Create the GPG keypair (do this on Grant's laptop, NOT in CI)

```bash
gpg --batch --gen-key <<EOF
Key-Type: RSA
Key-Length: 4096
Name-Real: Housemait Backups
Name-Email: backups@housemait.com
Expire-Date: 0
%no-protection
%commit
EOF
```

`%no-protection` means no passphrase — required because the daily job
needs to encrypt non-interactively. Security comes from the private
key never leaving Grant's laptop, not from a passphrase.

Export the public key (paste this into GH secret `BACKUP_GPG_PUBLIC_KEY`):

```bash
gpg --armor --export backups@housemait.com
```

Export the private key for cold storage (1Password + paper printout):

```bash
gpg --armor --export-secret-keys backups@housemait.com
```

Note the recipient identifier (paste into GH secret `BACKUP_GPG_RECIPIENT`):

```
backups@housemait.com
```

### 2. Create the Supabase backup role

Already done — see the SQL block at the top of this DR doc's commit
history. Connection string lives in 1Password as
"Housemait — Supabase backup_user".

The role has:
- `pg_read_all_data` (SELECT on all current + future tables)
- `BYPASSRLS` (sees all rows regardless of RLS policies)
- `CONNECTION LIMIT 3` (sanity cap)

Use the **Session pooler** endpoint (`*.pooler.supabase.com:5432`) —
the Direct connection is IPv6-only and won't work from GitHub Actions.

### 3. Create the R2 bucket

In the Cloudflare dashboard:

1. **R2 → Create bucket** → name `housemait-backups`
   - Location: Eastern Europe (EU), Eastern North America, or wherever
     your existing `housemait-documents` bucket isn't (geographic
     diversity).
2. **Settings → Object Lifecycle Rules** → add three rules:
   - Rule 1: prefix `daily/`, expire after **7 days**
   - Rule 2: prefix `weekly/`, expire after **28 days**
   - Rule 3: prefix `monthly/`, expire after **365 days**
   *Note: implementing the weekly/monthly tiering is a TODO — current
   workflow only writes to `daily/`. To add tiering, extend
   `dump-and-upload.sh` to also `aws s3 cp` to `weekly/` on Sundays
   and `monthly/` on the 1st.*
3. **R2 → Manage R2 API Tokens** → create token:
   - Permissions: **Object Read & Write**
   - Scope: **Specify bucket** → `housemait-backups`
   - TTL: forever (rotate manually every ~12 months)
   - Save the **Access Key ID** + **Secret Access Key** + **Account ID**
     into 1Password.

### 4. Add GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret name | Value |
|---|---|
| `BACKUP_DB_URL` | The full `postgresql://backup_user.<project-ref>:...@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require` connection string |
| `BACKUP_GPG_PUBLIC_KEY` | Paste the multi-line ASCII-armoured public key from step 1 |
| `BACKUP_GPG_RECIPIENT` | `backups@housemait.com` |
| `R2_ACCOUNT_ID` | Cloudflare account id (long hex string from R2 dashboard) |
| `R2_BACKUP_ACCESS_KEY_ID` | From step 3 |
| `R2_BACKUP_SECRET_ACCESS_KEY` | From step 3 |
| `R2_BACKUP_BUCKET_NAME` | `housemait-backups` |

### 5. Trigger a first run manually

Repo → Actions → `backup-database` → **Run workflow** → Run.

Should complete in 1–3 min. Check the logs for `✅ Backup complete:`
and a non-zero size. If it fails, the logs will tell you which step
broke (most common: secret typo, R2 bucket name mismatch).

### 6. Verify the backup is decryptable on Grant's laptop

```bash
# Download the latest backup
aws s3 ls s3://housemait-backups/daily/ \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com | tail -1

aws s3 cp s3://housemait-backups/daily/<file> ./tmp/ \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com

# Decrypt
gpg --decrypt ./tmp/<file> | gzip -d | head -50
```

You should see `PostgreSQL database dump` at the top + the first few
CREATE TABLE statements. If you do, end-to-end is working.

---

## Restore procedure — for a real DR event

You're here because production Postgres is gone, corrupt, or
compromised. Steps assume you're on Grant's laptop with the GPG
private key available.

### Path A — restore into a fresh Supabase project (recommended)

1. **Create a fresh Supabase project** in the dashboard. Same region
   as the original. Note the project ref + DB password.

2. **Pick the backup to restore from.** Latest is usually right;
   if production was compromised, you may want yesterday's instead.

   ```bash
   aws s3 ls s3://housemait-backups/daily/ \
     --endpoint-url https://<account>.r2.cloudflarestorage.com
   ```

3. **Download it locally:**
   ```bash
   aws s3 cp s3://housemait-backups/daily/housemait-<ts>.sql.gz.gpg ./ \
     --endpoint-url https://<account>.r2.cloudflarestorage.com
   ```

4. **Restore:**
   ```bash
   ./scripts/backup/restore.sh \
     ./housemait-<ts>.sql.gz.gpg \
     'postgresql://postgres:<NEW_DB_PASSWORD>@db.<NEW_PROJECT_REF>.supabase.co:5432/postgres?sslmode=require'
   ```

   The script:
   - Refuses to run if the target has any existing `calendar_events`
     (override with `ALLOW_NON_EMPTY=1` if you really mean it).
   - Streams decrypt → ungzip → psql, no plaintext on disk.
   - Reports row counts at the end so you can spot-check.

5. **Re-create the backup_user role** (it's not in the public-schema
   dump). Run the SQL block from "One-time setup checklist" step 2
   in the new project's SQL Editor. Update GH secret `BACKUP_DB_URL`
   to point at the new pooler URL.

6. **Update Railway env vars** to point at the new Supabase project:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DATABASE_URL` (if used directly anywhere)

   Railway will redeploy; the API should come back up against the
   restored DB within a couple of minutes.

7. **Send password-reset emails** to all users (the `auth.users` table
   in the new Supabase project is empty — they need to set new
   passwords via Supabase Auth's email flow). The user records in
   `public.users` are intact, so this is just re-establishing auth
   credentials for them.

### Path B — restore into the same project (in-place rewind)

Riskier — if production data is corrupt, you don't want to leave
half of it around. Only do this if you specifically need to keep the
project ref (e.g. to avoid updating a hard-coded `SUPABASE_URL` in
mobile clients that are already shipped).

1. In Supabase SQL Editor, drop the corrupted tables manually
   (`DROP TABLE public.calendar_events CASCADE;` etc).
2. Run `restore.sh` against the same project's connection string with
   `ALLOW_NON_EMPTY=1`.
3. Verify row counts match the pre-disaster state if you have one
   recorded.

---

## Restore drill — do this monthly

Backups that haven't been tested aren't backups; they're hopeful files
in a bucket. Calendar reminder for the 1st of every month:

1. Spin up a free-tier Supabase project (separate from production).
2. Run the restore procedure (Path A) end-to-end.
3. Open the SQL editor on the restored project. Run:
   ```sql
   SELECT
     (SELECT count(*) FROM households)        AS households,
     (SELECT count(*) FROM users)             AS users,
     (SELECT count(*) FROM calendar_events)   AS events,
     (SELECT count(*) FROM tasks)             AS tasks,
     (SELECT count(*) FROM shopping_items)    AS shopping;
   ```
   Compare each count against production (run the same query in the
   prod SQL Editor). Within ~1 day of churn, they should match.
4. Delete the restore-drill project.
5. Tick the drill off in this document's "Drill log" below.

### Drill log

Append a row each month: `YYYY-MM-DD | who | result | notes`.

| Date | Who | Result | Notes |
|---|---|---|---|
| _(awaiting first drill)_ | | | |

---

## Cost expectations

Based on the current ~30–80 MB compressed dump size:

- **R2 storage**: ~$0.50–$2/month at the 7-daily + 4-weekly + 12-monthly
  retention. Trivial.
- **R2 egress**: $0/GB (free) — you can pull a backup to test-restore
  any time without cost penalty.
- **GitHub Actions**: ~3 min/run × 30 days = 90 min/month. Free tier
  is 2,000 min/month; backup uses ~5%.

---

## Things that would scare me / open follow-ups

1. **No notification on success.** Currently you only know if a backup
   *fails* (GH email). Worth adding a weekly "all backups still going"
   ping to Postmark so silent failures (e.g. cron paused after 60 days
   of repo inactivity) get caught.
2. **Weekly/monthly tiering is currently aspirational** — the workflow
   only writes to `daily/` and the lifecycle rule expires everything at
   7 days. Real tiering needs the dump script to also `aws s3 cp` to
   `weekly/` on Sundays and `monthly/` on the 1st. Easy follow-up.
3. **R2 documents bucket has no off-Cloudflare backup.** A failure of
   Cloudflare R2 itself (extremely unlikely but theoretically possible)
   would lose all uploaded household documents. Mitigation: enable R2
   bucket-to-bucket replication, or periodically sync the documents
   bucket to a different cloud (S3 / Backblaze B2). Out of scope for
   v1 of this pipeline.
4. **Private key has no expiry**. `Expire-Date: 0` in the keygen step
   makes the key valid forever. Industry good practice is to rotate
   every 1–2 years. Calendar reminder for May 2027 to generate a new
   keypair, re-encrypt one fresh backup, switch CI to the new public
   key, and decommission the old one.
