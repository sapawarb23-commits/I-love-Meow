#!/usr/bin/env bash
# scripts/backup.sh — snapshots the SQLite database safely (using SQLite's
# own online backup, so it's consistent even while the app is writing to
# it), keeps a local rolling window of backups, and optionally pushes the
# snapshot to S3/R2/B2 for offsite disaster recovery.
#
# Run manually:            npm run backup
# Run on a schedule:       add to host crontab, e.g.
#   0 3 * * * cd /path/to/i-love-meow && ./scripts/backup.sh >> backups/backup.log 2>&1
# Run inside Docker:       docker compose exec app sh -c "cd / && ..." —
#   simplest is a host-level cron calling this script against the
#   `db-data` volume mount path, since the app container has no cron.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${DB_PATH:-$PROJECT_ROOT/data/ilovemeow.db}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/ilovemeow-$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "No database found at $DB_PATH — nothing to back up." >&2
  exit 1
fi

echo "Backing up $DB_PATH -> $OUT_FILE"

if command -v sqlite3 >/dev/null 2>&1; then
  # `.backup` is SQLite's own online-backup API: safe against a concurrently
  # writing process, unlike a plain `cp` (which can copy a half-written page
  # or miss data still sitting in the WAL file).
  sqlite3 "$DB_PATH" ".backup '$OUT_FILE'"
else
  echo "sqlite3 CLI not found — falling back to node:sqlite for a consistent backup." >&2
  node --input-type=module -e "
    import { DatabaseSync } from 'node:sqlite';
    const src = new DatabaseSync('$DB_PATH', { readOnly: true });
    src.exec(\"VACUUM INTO '$OUT_FILE'\");
    src.close();
  "
fi

gzip -f "$OUT_FILE"
OUT_FILE="$OUT_FILE.gz"
echo "Backup written: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# ---------- optional offsite copy ----------
if [ -n "${BACKUP_S3_BUCKET:-}" ] && command -v aws >/dev/null 2>&1; then
  ENDPOINT_ARG=()
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ENDPOINT_ARG=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  aws s3 cp "$OUT_FILE" "s3://$BACKUP_S3_BUCKET/$(basename "$OUT_FILE")" "${ENDPOINT_ARG[@]}"
  echo "Uploaded to s3://$BACKUP_S3_BUCKET/$(basename "$OUT_FILE")"
elif [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "BACKUP_S3_BUCKET is set but the aws CLI isn't installed — skipping offsite upload." >&2
fi

# ---------- local retention ----------
find "$BACKUP_DIR" -name 'ilovemeow-*.db.gz' -mtime "+$RETENTION_DAYS" -print -delete

echo "Done."
