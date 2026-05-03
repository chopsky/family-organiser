#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# dump-and-upload.sh
#
# Off-site Postgres backup: pg_dump → gzip → gpg --encrypt → upload to R2.
#
# Designed to run from GitHub Actions on a daily cron (see
# .github/workflows/backup-database.yml). Can also be run locally for
# ad-hoc snapshots — same env-var contract.
#
# Encryption is asymmetric: the GPG public key lives in CI (a GH secret),
# the private key never touches the runner. A successful decrypt requires
# the private key, which lives only on Grant's laptop + 1Password + a
# printed cold-storage copy in a safe.
#
# We deliberately don't print or log the connection string anywhere.
#
# ─── Required env vars ─────────────────────────────────────────────────
#   BACKUP_DB_URL          — full postgresql:// connection string for
#                            the backup_user role (BYPASSRLS, read-only).
#                            Use the Supabase Session pooler endpoint
#                            (port 5432, *.pooler.supabase.com) — the
#                            Direct connection is IPv6-only and won't
#                            work from GH Actions runners.
#   BACKUP_GPG_PUBLIC_KEY  — ASCII-armoured GPG public key (multi-line).
#   BACKUP_GPG_RECIPIENT   — the recipient identifier for that key
#                            (email or fingerprint).
#   R2_ACCOUNT_ID          — Cloudflare R2 account id.
#   R2_ACCESS_KEY_ID       — R2 API token (write-scoped to backup bucket).
#   R2_SECRET_ACCESS_KEY   — paired secret.
#   R2_BUCKET_NAME         — destination bucket (e.g. "housemait-backups").
#
# Exit codes: 0 ok, non-zero on any failure (CI fails the job → email).
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Validate env ──────────────────────────────────────────────────────
required=(
  BACKUP_DB_URL
  BACKUP_GPG_PUBLIC_KEY
  BACKUP_GPG_RECIPIENT
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME
)
for var in "${required[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "❌ Missing required env var: $var" >&2
    exit 1
  fi
done

# ─── Tooling sanity ────────────────────────────────────────────────────
for tool in pg_dump gpg gzip aws; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ Missing required tool: $tool" >&2
    exit 1
  fi
done

PG_DUMP_VERSION="$(pg_dump --version | awk '{print $NF}' | cut -d. -f1)"
if [[ "$PG_DUMP_VERSION" -lt 15 ]]; then
  echo "❌ pg_dump v${PG_DUMP_VERSION} too old; Supabase needs v15+" >&2
  exit 1
fi

# ─── File naming ───────────────────────────────────────────────────────
# ISO 8601 timestamp, no colons (S3 keys are friendlier without).
TIMESTAMP="$(date -u +'%Y-%m-%dT%H-%M-%SZ')"
BACKUP_KEY="daily/housemait-${TIMESTAMP}.sql.gz.gpg"

# Local working dir — use a tempdir so a failed run leaves nothing behind.
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

GNUPGHOME="$WORKDIR/gnupg"
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
export GNUPGHOME

# ─── Import the public key into a clean keyring ────────────────────────
echo "→ Importing GPG public key…"
echo "$BACKUP_GPG_PUBLIC_KEY" | gpg --batch --import 2>&1 \
  | grep -E "^gpg: key" || true
# `--trust-model always` lets us encrypt to a key without going through
# the trust DB ceremony — appropriate in CI where we explicitly trust
# the key we just imported one second ago.

# ─── pg_dump → gzip → gpg → R2 ─────────────────────────────────────────
# Single pipeline, streamed end-to-end. No plaintext ever lands on disk
# — even gzipped — which means a malicious reader of the runner's
# filesystem at peak memory can't see anything decryptable.
#
# pg_dump flags:
#   --schema=public      Skip Supabase-managed schemas (auth, storage,
#                        realtime, extensions, vault, pgsodium, …) —
#                        those are rebuilt from scratch on a fresh
#                        Supabase project, so they're not useful in a
#                        backup. Just adds noise + size.
#   --no-owner           Don't emit ALTER OWNER statements — the postgres
#                        role names differ between projects, so emitting
#                        them makes the dump less portable on restore.
#   --no-acl             Skip GRANT / REVOKE statements for the same reason.
#   --no-privileges      Same family — drops permission metadata.
#   --format=plain       Plain SQL output. Matches pipe-friendliness here.
#                        For very large DBs we'd switch to --format=custom
#                        for parallel restore — Housemait is nowhere near
#                        that point.
#
# aws CLI flags:
#   --endpoint-url       R2's S3-compatible endpoint, account-scoped.
#   The credentials are picked up from the AWS_* env vars we set below.

echo "→ Dumping + encrypting + uploading to R2 (this may take 1–3 min)…"

# Set AWS env vars from R2 creds for the duration of the upload.
# Shadowing scope: only this script's env, not exported back to caller.
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

pg_dump \
    --schema=public \
    --no-owner \
    --no-acl \
    --no-privileges \
    --format=plain \
    "$BACKUP_DB_URL" \
  | gzip --best \
  | gpg \
      --batch --yes \
      --trust-model always \
      --encrypt \
      --recipient "$BACKUP_GPG_RECIPIENT" \
      --compress-algo none \
  | aws s3 cp - "s3://${R2_BUCKET_NAME}/${BACKUP_KEY}" \
      --endpoint-url "$R2_ENDPOINT" \
      --no-progress

# ─── Confirm + report size ─────────────────────────────────────────────
echo "→ Confirming upload…"
SIZE_BYTES="$(
  aws s3api head-object \
    --bucket "$R2_BUCKET_NAME" \
    --key "$BACKUP_KEY" \
    --endpoint-url "$R2_ENDPOINT" \
    --query 'ContentLength' \
    --output text
)"

if [[ -z "$SIZE_BYTES" || "$SIZE_BYTES" == "None" || "$SIZE_BYTES" -lt 1024 ]]; then
  echo "❌ Uploaded object is suspiciously small (${SIZE_BYTES} bytes). Investigate." >&2
  exit 1
fi

# Pretty-print the size in MB
SIZE_MB="$(awk -v b="$SIZE_BYTES" 'BEGIN { printf "%.2f", b / 1024 / 1024 }')"

echo ""
echo "✅ Backup complete:"
echo "   bucket : $R2_BUCKET_NAME"
echo "   key    : $BACKUP_KEY"
echo "   size   : ${SIZE_MB} MB (${SIZE_BYTES} bytes)"
echo ""
echo "Retention is governed by R2 lifecycle rules on the bucket — see"
echo "docs/disaster-recovery.md for the policy."
