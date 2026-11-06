#!/usr/bin/env bash
# Nightly backup (P4-BACKUP-01, -03): the database and the workbook files, encrypted with the
# owner's passphrase (GnuPG, AES-256), kept 7 days here and 30 days in Google Drive.
#   ops/backup.sh               full backup (systemd timer, 02:30 IST)
#   ops/backup.sh --local-only  before a deploy: kept here only
# Any failure sends an alert and exits non-zero.
source "$(dirname "$0")/lib.sh"
set -E # the ERR trap also fires inside functions
require_root
OPS="$(cd "$(dirname "$0")" && pwd)"

LOCAL_ONLY=0
[ "${1:-}" = "--local-only" ] && LOCAL_ONLY=1
STEP="starting"
on_error() {
  "$OPS/notify.sh" "Backup FAILED" "The backup stopped while $STEP. Nothing new reached Google Drive tonight.
Check: journalctl -u jdsheets-backup --since today" || true
}
trap on_error ERR

TAG="$(deployed_tag)"
[ -n "$TAG" ] || { STEP="looking for the deployed version"; false; }
PASSFILE="$JD_ETC/backup.pass"
[ -s "$PASSFILE" ] || { STEP="reading the backup passphrase ($PASSFILE is missing)"; false; }
BACKUPS="$JD_DIR/backups"
mkdir -p "$BACKUPS"
chmod 700 "$BACKUPS"
NAME="jdsheets-$(date -u +%Y%m%d-%H%M%S).tar.gpg"
WORK="$(mktemp -d "$BACKUPS/.work.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

STEP="dumping the database"
compose_for "$TAG" exec -T db pg_dump -U jdsheets -d jdsheets --format=custom >"$WORK/database.dump"
[ -s "$WORK/database.dump" ]

STEP="copying the workbook files"
docker run --rm -v "${JD_PROJECT}_workbooks:/data:ro" alpine:3.22 tar -C /data -cf - . >"$WORK/workbooks.tar"

printf 'version=%s\ncreated=%s\n' "$TAG" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$WORK/backup-info.txt"

STEP="encrypting"
tar -C "$WORK" -cf - database.dump workbooks.tar backup-info.txt |
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASSFILE" \
    --symmetric --cipher-algo AES256 --compress-algo zlib -o "$BACKUPS/$NAME.part"
mv "$BACKUPS/$NAME.part" "$BACKUPS/$NAME"
echo "  saved $BACKUPS/$NAME ($(du -h "$BACKUPS/$NAME" | cut -f1))"

STEP="removing local copies older than 7 days"
find "$BACKUPS" -maxdepth 1 -name 'jdsheets-*.tar.gpg' -mtime +7 -delete

if [ "$LOCAL_ONLY" = 0 ]; then
  STEP="preparing the copy to Google Drive"
  REMOTE="$(env_value BACKUP_REMOTE)"
  REMOTE="${REMOTE:-gdrive:JD Sheets backups}"
  RCLONE=(docker run --rm -v "$JD_ETC:/config/rclone" -v "$BACKUPS:/backups:ro")
  if [[ "$REMOTE" == /* ]]; then # a folder standing in for Google Drive (drills)
    mkdir -p "$REMOTE"
    RCLONE+=(-v "$REMOTE:/remote")
    REMOTE="/remote"
  fi
  RCLONE+=(rclone/rclone:1.71.2)
  STEP="sending the backup to Google Drive"
  "${RCLONE[@]}" copyto "/backups/$NAME" "$REMOTE/$NAME"
  STEP="checking the copy in Google Drive"
  "${RCLONE[@]}" check --one-way --size-only "/backups/$NAME" "$REMOTE/$NAME" 2>/dev/null ||
    "${RCLONE[@]}" lsf "$REMOTE/$NAME" | grep -q .
  STEP="removing Google Drive copies older than 30 days"
  "${RCLONE[@]}" delete --min-age 30d --include 'jdsheets-*.tar.gpg' "$REMOTE"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$JD_STATE/last-backup-ok"
  echo "  copied to Google Drive"
fi
echo "Backup done: $NAME"
