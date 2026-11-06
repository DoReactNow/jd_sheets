#!/usr/bin/env bash
# First setup on the server (W-406, W-410). Safe to run again: existing settings are kept, only
# missing ones are asked for. Secrets are typed here by the owner or generated here, and never
# leave the server (Decision 60, P4-SEC-05).
source "$(dirname "$0")/lib.sh"
require_root

say "Checking the server"
command -v docker >/dev/null || fail "Docker is not installed"
docker compose version >/dev/null || fail "Docker Compose is not installed"
command -v openssl >/dev/null || fail "openssl is not installed"
TRAEFIK_NETWORK_NAME="${TRAEFIK_NETWORK:-root_default}"
docker network inspect "$TRAEFIK_NETWORK_NAME" >/dev/null 2>&1 ||
  fail "the Traefik network $TRAEFIK_NETWORK_NAME was not found"
ok "Docker, Compose and the Traefik network $TRAEFIK_NETWORK_NAME"

umask 077
mkdir -p "$JD_DIR/releases" "$JD_STATE" "$JD_ETC" "$JD_DIR/backups"
chmod 700 "$JD_DIR" "$JD_ETC" "$JD_DIR/backups"

ask() { # ask <NAME> <question> [default]
  local name="$1" question="$2" default="${3:-}" answer
  if [ -n "$(env_value "$name")" ]; then return; fi
  while :; do
    read -r -p "  $question${default:+ [$default]}: " answer
    answer="${answer:-$default}"
    [ -n "$answer" ] && break
  done
  printf '%s="%s"\n' "$name" "$answer" >>"$JD_ENV"
}
ask_secret() { # ask_secret <NAME> <question>
  local name="$1" question="$2" first second
  if [ -n "$(env_value "$name")" ]; then return; fi
  while :; do
    read -r -s -p "  $question: " first
    echo
    read -r -s -p "  Again, to check: " second
    echo
    [ -n "$first" ] && [ "$first" = "$second" ] && break
    echo "  They differ or are empty; try again."
  done
  printf '%s="%s"\n' "$name" "$first" >>"$JD_ENV"
}
set_value() { # set_value <NAME> <value>, only if missing
  [ -n "$(env_value "$1")" ] || printf '%s="%s"\n' "$1" "$2" >>"$JD_ENV"
}
secret() { openssl rand -base64 48 | tr -d '\n'; }

say "Settings (.env.production)"
touch "$JD_ENV"
chmod 600 "$JD_ENV"
ask SITE_DOMAIN "Web address, without https://" "sheets.jdfusion.in"
DOMAIN="$(env_value SITE_DOMAIN)"
set_value APP_ENV production
set_value APP_URL "https://$DOMAIN"
set_value APP_HOST 0.0.0.0
set_value APP_PORT 47320
set_value APP_INTERNAL_URL "http://app:47320"
set_value LOG_LEVEL info
if [ -z "$(env_value POSTGRES_PASSWORD)" ]; then
  PG="$(openssl rand -hex 32)"
  set_value POSTGRES_PASSWORD "$PG"
  set_value DATABASE_URL "postgresql://jdsheets:$PG@db:5432/jdsheets"
fi
set_value NETWORK_ENFORCEMENT on
set_value TRUSTED_PROXY_HOPS 2
set_value EDGE_ALLOWED_CIDRS "0.0.0.0/0 ::/0"
set_value TRAEFIK_NETWORK "$TRAEFIK_NETWORK_NAME"
SUBNET="$(docker network inspect "$TRAEFIK_NETWORK_NAME" -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' | xargs)"
[ -n "$SUBNET" ] || fail "could not read the range of $TRAEFIK_NETWORK_NAME"
set_value EDGE_TRUSTED_PROXIES "$SUBNET"
set_value TRAEFIK_CERT_RESOLVER mytlschallenge
set_value JDSHEETS_REGISTRY ghcr.io/doreactnow/jd_sheets
set_value COLLAB_URL "http://collab:47321"
set_value COLLAB_PUBLIC_URL "wss://$DOMAIN"
set_value COLLAB_HOST 0.0.0.0
set_value COLLAB_PORT 47321
set_value COLLAB_TOKEN_SECRET "$(secret)"
set_value INTERNAL_SERVICE_TOKEN "$(secret)"
set_value AUTH_SECRET "$(secret)"
set_value WORKBOOK_VALIDATOR collab
set_value STORAGE_DRIVER local
set_value STORAGE_LOCAL_DIR /data/workbooks
set_value MAIL_DRIVER smtp
set_value SMTP_HOST smtp.gmail.com
set_value SMTP_PORT 465
ask SMTP_USER "Gmail address that sends the sign-up codes"
set_value MAIL_FROM "JD Sheets <$(env_value SMTP_USER)>"
ask_secret SMTP_PASSWORD "That Gmail account's app password (16 letters; spaces are fine)"
ask ALERT_EMAIL "Email address for alerts" "$(env_value SMTP_USER)"
ask SEED_SUPER_ADMIN_EMAIL "Email of the first Super Admin"
ask BOOTSTRAP_ALLOWED_CIDRS "Office addresses, comma-separated (for example 1.2.3.4/32,5.6.7.8/32)"
ok "settings saved in $JD_ENV (readable by root only)"

say "Backup passphrase"
if [ -s "$JD_ETC/backup.pass" ]; then
  ok "already set ($JD_ETC/backup.pass)"
else
  echo "  It locks the backups. Keep it in your password manager and on paper:"
  echo "  if it is lost, the backups cannot be opened."
  while :; do
    read -r -s -p "  Backup passphrase (at least 16 characters): " first
    echo
    read -r -s -p "  Again, to check: " second
    echo
    [ "${#first}" -ge 16 ] && [ "$first" = "$second" ] && break
    echo "  Too short or they differ; try again."
  done
  printf '%s' "$first" >"$JD_ETC/backup.pass"
  chmod 600 "$JD_ETC/backup.pass"
  ok "saved in $JD_ETC/backup.pass (readable by root only)"
fi

say "Setup done. Next: ops/deploy.sh <tag>, then ops/admin.sh first-run"
