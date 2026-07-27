#!/usr/bin/env bash
# scripts/restore.sh — restores a backup produced by scripts/backup.sh.
# ALWAYS stop the app before restoring, or writes racing the restore can
# corrupt the file.
#
# Usage:
#   ./scripts/restore.sh backups/ilovemeow-20260713T030000Z.db.gz
#   ./scripts/restore.sh s3://my-bucket/ilovemeow-20260713T030000Z.db.gz

set -euo pipefail

SOURCE="${1:?Usage: $0 <path-to-backup.db.gz | s3://bucket/key.db.gz>}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${DB_PATH:-$PROJECT_ROOT/data/ilovemeow.db}"

echo "This will REPLACE $DB_PATH with the contents of $SOURCE."
read -r -p "Have you stopped the app (docker compose stop app)? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted. Run: docker compose stop app   then re-run this script."
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

if [[ "$SOURCE" == s3://* ]]; then
  command -v aws >/dev/null 2>&1 || { echo "aws CLI required to restore from S3."; exit 1; }
  aws s3 cp "$SOURCE" "$WORK_DIR/backup.db.gz"
  LOCAL_GZ="$WORK_DIR/backup.db.gz"
else
  LOCAL_GZ="$SOURCE"
fi

# Safety net: snapshot whatever's currently on disk before overwriting it.
if [ -f "$DB_PATH" ]; then
  PRE_RESTORE_COPY="$DB_PATH.pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  cp "$DB_PATH" "$PRE_RESTORE_COPY"
  echo "Existing database saved to $PRE_RESTORE_COPY as a safety net."
fi

gunzip -c "$LOCAL_GZ" > "$DB_PATH"
echo "Restored $DB_PATH from $SOURCE."
echo "Verify with: sqlite3 $DB_PATH 'PRAGMA integrity_check;'"
echo "Then start the app back up: docker compose start app"
