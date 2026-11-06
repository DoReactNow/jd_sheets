#!/usr/bin/env bash
# Sends one alert email to ALERT_EMAIL through the app's Gmail account (Decision 61).
# Usage: ops/notify.sh "<subject>" "<body>"
# With ALERT_OUTBOX set (drills and CI), the message is appended to that file instead.
source "$(dirname "$0")/lib.sh"

SUBJECT="[JD Sheets] $1"
BODY="${2:-}"
TO="$(env_value ALERT_EMAIL)"
FROM="$(env_value SMTP_USER)"
MESSAGE="From: JD Sheets alerts <$FROM>
To: $TO
Subject: $SUBJECT
Date: $(date -R)
Content-Type: text/plain; charset=utf-8

$BODY

Server: $(hostname)
Runbook: CONTEXT/runbook.md, 'When things go wrong'
"

if [ -n "${ALERT_OUTBOX:-}" ]; then
  printf '%s\n----\n' "$MESSAGE" >>"$ALERT_OUTBOX"
  exit 0
fi

[ -n "$TO" ] && [ -n "$FROM" ] || fail "ALERT_EMAIL and SMTP_USER must be set in $JD_ENV"
NETRC="$(mktemp)"
trap 'rm -f "$NETRC"' EXIT
chmod 600 "$NETRC"
# The password goes through a root-only temporary file, never the command line.
printf 'machine %s login %s password %s\n' "$(env_value SMTP_HOST)" "$FROM" \
  "$(env_value SMTP_PASSWORD | tr -d ' ')" >"$NETRC"
printf '%s' "$MESSAGE" | curl -sS --ssl-reqd --max-time 30 \
  --url "smtps://$(env_value SMTP_HOST):$(env_value SMTP_PORT)" \
  --netrc-file "$NETRC" --mail-from "$FROM" --mail-rcpt "$TO" --upload-file - >/dev/null
