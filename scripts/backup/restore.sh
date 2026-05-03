#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# restore.sh
#
# Companion to dump-and-upload.sh. Decrypts a backup file produced by
# the daily job and replays it into a target Postgres database.
#
# Designed to be run LOCALLY on Grant's laptop (where the GPG private
# key lives), NOT in CI. CI never touches the private key.
#
# Usage:
#   ./restore.sh <encrypted-backup-file> <target-postgres-url>
#
# Example (restore yesterday's backup into a freshly-created Supabase
# project for a restore drill):
#   ./restore.sh \
#     ./housemait-2026-05-03T03-00-00Z.sql.gz.gpg \
#     'postgresql://postgres.NEW_PROJECT_REF:NEWPASS@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require'
#
# Safety rails:
#   • Refuses to run if the target database already has a non-empty
#     calendar_events table — protects against accidentally restoring
#     yesterday's data over today's production. To bypass, set
#     ALLOW_NON_EMPTY=1 in env.
#   • Streams decrypt → ungzip → psql so the plaintext SQL never lands
#     on disk. Memory pressure for a few-hundred-MB dump is fine on any
#     modern laptop.
#   • Echoes target host before doing anything destructive so you can
#     ctrl-C if you typed the wrong URL.
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

if [[ $# -ne 2 ]]; then
  cat <<'EOF' >&2
Usage: ./restore.sh <encrypted-backup-file> <target-postgres-url>

Restores a Housemait off-site backup into the given Postgres database.

The backup file must be one produced by dump-and-upload.sh (.sql.gz.gpg
format, encrypted to your GPG public key).

The target URL should be the postgres user (or any role with CREATE
privileges) — backup_user is read-only so it can't restore.

Set ALLOW_NON_EMPTY=1 to skip the "non-empty target" safety check
(use this when intentionally restoring over a populated DB).
EOF
  exit 64
fi

BACKUP_FILE="$1"
TARGET_URL="$2"
ALLOW_NON_EMPTY="${ALLOW_NON_EMPTY:-0}"

# ─── Sanity ────────────────────────────────────────────────────────────
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "❌ Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

for tool in gpg gzip psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ Missing required tool: $tool" >&2
    exit 1
  fi
done

# Echo the target host (without leaking the password) so the operator
# can confirm before anything happens.
TARGET_HOST="$(echo "$TARGET_URL" | sed -E 's|.*@([^:/]+).*|\1|')"
TARGET_DB="$(echo "$TARGET_URL" | sed -E 's|.*/([^?]+).*|\1|')"

echo ""
echo "About to restore:"
echo "   from    : $BACKUP_FILE"
echo "   target  : $TARGET_HOST / $TARGET_DB"
echo ""

# ─── Pre-flight: refuse to restore over a populated DB ─────────────────
if [[ "$ALLOW_NON_EMPTY" != "1" ]]; then
  echo "→ Checking target is empty (calendar_events row count == 0)…"
  EXISTING="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM calendar_events;" 2>/dev/null || echo "missing")"

  if [[ "$EXISTING" == "missing" ]]; then
    echo "  Target has no calendar_events table — assuming fresh DB. ✓"
  elif [[ "$EXISTING" -eq 0 ]]; then
    echo "  Target has 0 calendar_events. ✓"
  else
    echo ""
    echo "❌ Target already has $EXISTING calendar_events. Refusing to restore."
    echo "   To force, re-run with: ALLOW_NON_EMPTY=1 $0 ..." >&2
    exit 1
  fi
fi

echo ""
read -r -p "Type 'restore' to proceed: " CONFIRM
if [[ "$CONFIRM" != "restore" ]]; then
  echo "Aborted."
  exit 1
fi

# ─── Decrypt → ungzip → psql, streamed end-to-end ──────────────────────
# psql aborts on the first SQL error (-v ON_ERROR_STOP=1). Without this,
# a partial dump would silently leave the DB in a half-restored state.

echo ""
echo "→ Decrypting + restoring (this may take 5–15 min)…"

START="$(date +%s)"

gpg --decrypt --quiet "$BACKUP_FILE" \
  | gzip -d \
  | psql "$TARGET_URL" \
      --quiet \
      --variable ON_ERROR_STOP=1 \
      --no-psqlrc

END="$(date +%s)"
DURATION=$(( END - START ))

# ─── Quick verification ────────────────────────────────────────────────
echo ""
echo "→ Verifying restore…"
EVENT_COUNT="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM calendar_events;")"
USER_COUNT="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM users;")"
HOUSEHOLD_COUNT="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM households;")"

echo ""
echo "✅ Restore complete in ${DURATION}s:"
echo "   households       : $HOUSEHOLD_COUNT"
echo "   users            : $USER_COUNT"
echo "   calendar_events  : $EVENT_COUNT"
echo ""
echo "Compare these counts against the source DB to confirm full fidelity."
echo "Any zero count is suspicious unless you expected an empty source."
