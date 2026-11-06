#!/usr/bin/env bash
# Health check every 5 minutes (P4-OBS-01, systemd timer). One email when a problem starts and
# one when it clears; nothing in between. Checks: the five containers are healthy, disk, memory,
# days left on the HTTPS certificate, age of the last good backup.
# Limits can be changed for drills: WATCH_DISK_PERCENT, WATCH_MIN_AVAILABLE_MB, WATCH_CERT_DAYS,
# WATCH_BACKUP_HOURS, WATCH_CERT_HOST (default: the site address, port 443).
source "$(dirname "$0")/lib.sh"
require_root
OPS="$(cd "$(dirname "$0")" && pwd)"

DISK_LIMIT="${WATCH_DISK_PERCENT:-85}"
MIN_AVAILABLE_MB="${WATCH_MIN_AVAILABLE_MB:-300}"
CERT_DAYS="${WATCH_CERT_DAYS:-14}"
BACKUP_HOURS="${WATCH_BACKUP_HOURS:-26}"
ALERTS="$JD_STATE/alerts"
mkdir -p "$ALERTS"

# report <check> <problem text, empty when fine>
report() {
  local check="$1" problem="$2" flag="$ALERTS/$1"
  if [ -n "$problem" ] && [ ! -f "$flag" ]; then
    printf '%s\n' "$problem" >"$flag"
    "$OPS/notify.sh" "PROBLEM: $check" "$problem" || rm -f "$flag" # retry next run if mail failed
    echo "PROBLEM $check: $problem"
  elif [ -z "$problem" ] && [ -f "$flag" ]; then
    "$OPS/notify.sh" "Resolved: $check" "Fine again. It was: $(cat "$flag")" && rm -f "$flag"
    echo "resolved $check"
  fi
}

for service in db collab app worker caddy; do
  state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "${JD_PROJECT}-${service}-1" 2>/dev/null || echo "missing")"
  if [ "$state" = "healthy" ]; then report "$service" ""; else
    report "$service" "The $service container is $state. Docker restarts it by itself; if this mail repeats, see the runbook."
  fi
done

used="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')"
if [ "$used" -ge "$DISK_LIMIT" ]; then
  report disk "The disk is ${used}% full (limit ${DISK_LIMIT}%). Old backups and Docker images can be removed; see the runbook."
else report disk ""; fi

available_mb=$(($(awk '/^MemAvailable:/ {print $2}' /proc/meminfo) / 1024))
if [ "$available_mb" -lt "$MIN_AVAILABLE_MB" ]; then
  report memory "Only ${available_mb} MB of memory is free (limit ${MIN_AVAILABLE_MB} MB). All apps on the server may slow down."
else report memory ""; fi

DOMAIN="$(env_value SITE_DOMAIN)"
CERT_HOST="${WATCH_CERT_HOST:-127.0.0.1:443}"
end="$(echo | timeout 10 openssl s_client -connect "$CERT_HOST" -servername "$DOMAIN" 2>/dev/null |
  openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
if [ -z "$end" ]; then
  report certificate "Could not read the HTTPS certificate of $DOMAIN."
else
  days=$((($(date -d "$end" +%s) - $(date +%s)) / 86400))
  if [ "$days" -lt "$CERT_DAYS" ]; then
    report certificate "The HTTPS certificate of $DOMAIN ends in $days days; it should have renewed by itself (Traefik)."
  else report certificate ""; fi
fi

last="$JD_STATE/last-backup-ok"
if [ -f "$last" ]; then
  age_hours=$((($(date +%s) - $(date -d "$(cat "$last")" +%s)) / 3600))
  if [ "$age_hours" -ge "$BACKUP_HOURS" ]; then
    report backup "The last good backup is $age_hours hours old."
  else report backup ""; fi
elif [ -f "$JD_STATE/deployed-tag" ] &&
  [ -n "$(find "$JD_STATE/deployed-tag" -mmin +$((BACKUP_HOURS * 60)) 2>/dev/null)" ]; then
  report backup "No backup has reached Google Drive yet."
fi
