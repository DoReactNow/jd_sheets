#!/usr/bin/env bash
# Brings back the database and the workbook files from a backup (P4-BACKUP-02). On a fresh
# machine: ops/setup.sh (same passphrase), ops/deploy.sh <tag>, then this.
#   ops/restore.sh <file.tar.gpg>           a backup on this machine
#   ops/restore.sh --from-drive [name]      the newest (or named) backup in Google Drive
# Everything currently in JD Sheets is replaced. Asks for confirmation unless JD_YES=1.
source "$(dirname "$0")/lib.sh"
require_root

TAG="$(deployed_tag)"
[ -n "$TAG" ] || fail "deploy a version first (ops/deploy.sh <tag>)"
PASSFILE="$JD_ETC/backup.pass"
[ -s "$PASSFILE" ] || fail "$PASSFILE is missing; run ops/setup.sh and type the backup passphrase"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ "${1:-}" = "--from-drive" ]; then
  REMOTE="$(env_value BACKUP_REMOTE)"
  REMOTE="${REMOTE:-gdrive:JD Sheets backups}"
  RCLONE=(docker run --rm -v "$JD_ETC:/config/rclone" -v "$WORK:/work")
  if [[ "$REMOTE" == /* ]]; then RCLONE+=(-v "$REMOTE:/remote:ro"); REMOTE="/remote"; fi
  RCLONE+=(rclone/rclone:1.71.2)
  NAME="${2:-$("${RCLONE[@]}" lsf --include 'jdsheets-*.tar.gpg' "$REMOTE" | sort | tail -n 1)}"
  [ -n "$NAME" ] || fail "no backup found in $REMOTE"
  say "Downloading $NAME"
  "${RCLONE[@]}" copyto "$REMOTE/$NAME" "/work/$NAME"
  FILE="$WORK/$NAME"
else
  FILE="${1:-}"
  [ -f "$FILE" ] || fail "usage: restore.sh <file.tar.gpg> | --from-drive [name]"
fi

say "Unlocking $(basename "$FILE")"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSFILE" -d "$FILE" |
  tar -C "$WORK" -xf - || fail "could not unlock the backup (wrong passphrase, or a damaged file)"
cat "$WORK/backup-info.txt"

if [ "${JD_YES:-}" != "1" ]; then
  read -r -p "This REPLACES everything in JD Sheets with this backup. Type RESTORE to go on: " answer
  [ "$answer" = "RESTORE" ] || fail "nothing was changed"
fi

START=$(date +%s)
say "Stopping the app"
compose_for "$TAG" stop caddy app worker collab
say "Database"
# A fresh, empty database, then the dump: --clean on a live database trips over the job queue's
# partitioned tables.
compose_for "$TAG" exec -T db psql -v ON_ERROR_STOP=1 -U jdsheets -d postgres \
  -c "DROP DATABASE IF EXISTS jdsheets WITH (FORCE)" -c "CREATE DATABASE jdsheets OWNER jdsheets"
compose_for "$TAG" exec -T db pg_restore -U jdsheets -d jdsheets --no-owner --exit-on-error \
  <"$WORK/database.dump"
say "Workbook files"
docker run --rm -i -v "${JD_PROJECT}_workbooks:/data" alpine:3.22 \
  sh -c 'find /data -mindepth 1 -delete && tar -C /data -xf - && chown -R 1000:1000 /data' \
  <"$WORK/workbooks.tar"
say "Starting the app"
compose_for "$TAG" up -d --wait --wait-timeout 300
ok "restored in $(($(date +%s) - START)) seconds"
