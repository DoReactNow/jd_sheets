#!/usr/bin/env bash
# The production stack, checked end to end with the real images and the real ops scripts, behind
# a real Traefik set up like the server's (Decision 62). Runs in CI after the images are built.
# Usage: scripts/stack-check.sh <tag>
#   P4-DEPLOY-01  a failed migration leaves the running version serving
#   P4-DEPLOY-02  rollback starts the previous version
#   P4-SEC-01     security headers through Traefik and Caddy
#   P4-SEC-03     internal routes 404 from outside; nothing of ours publishes a port
#   P1-NET-16     Caddy's blocked page with a closed allowlist; a faked X-Forwarded-For is ignored
#   P4-DRILL-02   the recovery commands run in the deployed version
set -euo pipefail
TAG="${1:?usage: stack-check.sh <tag>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REG="${JDSHEETS_REGISTRY:-ghcr.io/doreactnow/jd_sheets}"
DOMAIN="sheets.ci.test"
WORK="$(mktemp -d)"
export JD_DIR="$WORK/jd" JD_ETC="$WORK/etc" JD_PROJECT=jdsheets ALERT_OUTBOX="$WORK/outbox"
problems=()
check() { # check <description> <command...>
  local what="$1"
  shift
  if "$@"; then echo "  ok   $what"; else echo "  FAIL $what"; problems+=("$what"); fi
}
url() { echo "https://127.0.0.1:8443$1"; }
get() { curl -sk -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" "$@"; }

echo "== Traefik like the server's (network root_default, resolver mytlschallenge)"
docker network create --subnet 172.30.0.0/16 root_default >/dev/null
docker run -d --name ci-traefik --network root_default -p 8443:443 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro traefik:v3.5 \
  --providers.docker=true --providers.docker.exposedbydefault=false \
  --entrypoints.web.address=:80 --entrypoints.websecure.address=:443 \
  --certificatesresolvers.mytlschallenge.acme.httpchallenge=true \
  --certificatesresolvers.mytlschallenge.acme.httpchallenge.entrypoint=web \
  --certificatesresolvers.mytlschallenge.acme.caserver=https://127.0.0.1:1/directory \
  --certificatesresolvers.mytlschallenge.acme.storage=/tmp/acme.json >/dev/null

echo "== Settings (what ops/setup.sh writes on the server)"
mkdir -p "$JD_DIR" "$JD_ETC"
secret() { openssl rand -base64 48 | tr -d '\n'; }
PG="$(openssl rand -hex 16)"
cat >"$JD_DIR/.env.production" <<ENV
SITE_DOMAIN="$DOMAIN"
APP_ENV="production"
APP_URL="https://$DOMAIN"
APP_HOST="0.0.0.0"
APP_PORT="47320"
APP_INTERNAL_URL="http://app:47320"
LOG_LEVEL="info"
POSTGRES_PASSWORD="$PG"
DATABASE_URL="postgresql://jdsheets:$PG@db:5432/jdsheets"
NETWORK_ENFORCEMENT="on"
TRUSTED_PROXY_HOPS="2"
EDGE_ALLOWED_CIDRS="0.0.0.0/0 ::/0"
TRAEFIK_NETWORK="root_default"
EDGE_TRUSTED_PROXIES="172.30.0.0/16"
TRAEFIK_CERT_RESOLVER="mytlschallenge"
JDSHEETS_REGISTRY="$REG"
COLLAB_URL="http://collab:47321"
COLLAB_PUBLIC_URL="wss://$DOMAIN"
COLLAB_HOST="0.0.0.0"
COLLAB_PORT="47321"
COLLAB_TOKEN_SECRET="$(secret)"
INTERNAL_SERVICE_TOKEN="$(secret)"
AUTH_SECRET="$(secret)"
WORKBOOK_VALIDATOR="collab"
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="/data/workbooks"
MAIL_DRIVER="smtp"
SMTP_HOST="127.0.0.1"
SMTP_PORT="2525"
SMTP_USER="sender@example.com"
SMTP_PASSWORD="not-used-in-the-stack-check"
MAIL_FROM="JD Sheets <sender@example.com>"
ALERT_EMAIL="alerts@example.com"
BACKUP_REMOTE="$WORK/drive"
SEED_SUPER_ADMIN_EMAIL="admin@jdfusion.in"
BOOTSTRAP_ALLOWED_CIDRS="203.0.113.0/24"
ENV
printf 'ci-backup-passphrase-0123456789' >"$JD_ETC/backup.pass"

echo "== First deploy"
bash "$ROOT/ops/deploy.sh" "$TAG"
printf 'Ci-Admin-Password-2026!\nCi-Admin-Password-2026!\n' | bash "$JD_DIR/current/ops/admin.sh" first-run

echo "== Checks"
check "health through Traefik and Caddy" test "$(get "$(url /api/health)")" = 200
HEADERS="$(curl -sk -D - -o /dev/null -H "Host: $DOMAIN" "$(url /sign-in)" | tr -d '\r')"
check "CSP with a nonce (P4-SEC-01)" grep -qiE "^content-security-policy:.*'nonce-" <<<"$HEADERS"
check "CSP lets the page reach the live service (wss)" grep -qiE "^content-security-policy:.*connect-src[^;]*wss://$DOMAIN" <<<"$HEADERS"
check "HSTS (P4-SEC-01)" grep -qiE "^strict-transport-security: max-age=[0-9]{8}" <<<"$HEADERS"
check "no-sniff (P4-SEC-01)" grep -qiE "^x-content-type-options: nosniff" <<<"$HEADERS"
check "referrer policy (P4-SEC-01)" grep -qiE "^referrer-policy: " <<<"$HEADERS"
check "frame rules (P4-SEC-01)" grep -qiE "frame-ancestors" <<<"$HEADERS"
check "no Server header" bash -c '! grep -qiE "^server: (caddy|next)" <<<"$1"' _ "$HEADERS"
check "/api/internal/* is 404 from outside (P4-SEC-03)" test "$(get "$(url /api/internal/collab/snapshots)")" = 404
check "/internal/* is 404 from outside (P4-SEC-03)" test "$(get "$(url /internal/health)")" = 404
PUBLISHED="$(docker ps --filter label=com.docker.compose.project=jdsheets --format '{{.Names}} {{.Ports}}' | grep -E '0\.0\.0\.0|\[::\]' || true)"
check "no JD Sheets container publishes a port (P4-SEC-03)" test -z "$PUBLISHED"

echo "== Logs hold no secrets (P4-OBS-02)"
ORIGIN="Origin: https://$DOMAIN"
curl -sk -o /dev/null -H "Host: $DOMAIN" -H "$ORIGIN" -H 'content-type: application/json' \
  -d '{"email":"admin@jdfusion.in","password":"Wrong-Secret-Value-77"}' "$(url /api/auth/sign-in)"
TOKEN="$(curl -sk -D - -o /dev/null -H "Host: $DOMAIN" -H "$ORIGIN" -H 'content-type: application/json' \
  -d '{"email":"admin@jdfusion.in","password":"Ci-Admin-Password-2026!"}' "$(url /api/auth/sign-in)" |
  tr -d '\r' | sed -n 's/^set-cookie: [^=]*=\([^;]*\);.*/\1/Ip' | head -n 1)"
check "the Super Admin can sign in (session cookie issued)" test -n "$TOKEN"
check "the session cookie is Secure and HttpOnly" bash -c 'curl -sk -D - -o /dev/null -H "Host: $1" -H "Origin: https://$1" \
  -H "content-type: application/json" -d "{\"email\":\"admin@jdfusion.in\",\"password\":\"Ci-Admin-Password-2026!\"}" \
  "https://127.0.0.1:8443/api/auth/sign-in" | grep -i "^set-cookie:" | grep -qi "secure" ' _ "$DOMAIN"
LOGS="$WORK/all-logs.txt"
for c in $(docker ps -aq --filter label=com.docker.compose.project=jdsheets); do docker logs "$c" >>"$LOGS" 2>&1; done
leaks=()
for value in "Ci-Admin-Password-2026!" "Wrong-Secret-Value-77" "$TOKEN" "$PG" \
  "$(sed -n 's/^AUTH_SECRET="\(.*\)"/\1/p' "$JD_DIR/.env.production")" \
  "$(sed -n 's/^COLLAB_TOKEN_SECRET="\(.*\)"/\1/p' "$JD_DIR/.env.production")" \
  "$(sed -n 's/^INTERNAL_SERVICE_TOKEN="\(.*\)"/\1/p' "$JD_DIR/.env.production")"; do
  [ -n "$value" ] && grep -qF -- "$value" "$LOGS" && leaks+=("${value:0:4}...")
done
check "no password, session, database password or secret in any log (${#leaks[@]} found)" test "${#leaks[@]}" = 0

echo "== Client address: only Traefik may set it (P1-NET-16)"
sed -i 's|^EDGE_ALLOWED_CIDRS=.*|EDGE_ALLOWED_CIDRS="203.0.113.9/32"|' "$JD_DIR/.env.production"
JDSHEETS_TAG="$TAG" docker compose -p jdsheets --env-file "$JD_DIR/.env.production" \
  -f "$JD_DIR/current/docker-compose.prod.yml" up -d --wait caddy
check "an address outside the allowlist gets the blocked page (403)" test "$(get "$(url /sign-in)")" = 403
check "a faked X-Forwarded-For does not get through" \
  test "$(get -H 'X-Forwarded-For: 203.0.113.9' "$(url /sign-in)")" = 403
sed -i 's|^EDGE_ALLOWED_CIDRS=.*|EDGE_ALLOWED_CIDRS="0.0.0.0/0 ::/0"|' "$JD_DIR/.env.production"
JDSHEETS_TAG="$TAG" docker compose -p jdsheets --env-file "$JD_DIR/.env.production" \
  -f "$JD_DIR/current/docker-compose.prod.yml" up -d --wait caddy

echo "== A failed migration leaves the running version serving (P4-DEPLOY-01)"
for name in app worker collab ops; do docker tag "$REG/$name:$TAG" "$REG/$name:$TAG-broken"; done
printf 'FROM %s\nCMD ["sh", "-c", "echo deliberately failing migration; exit 1"]\n' "$REG/migrator:$TAG" |
  docker build -q -t "$REG/migrator:$TAG-broken" - >/dev/null
check "deploy of a broken migration stops" bash -c '! bash "$1/ops/deploy.sh" "$2-broken"' _ "$ROOT" "$TAG"
check "the running version is unchanged" test "$(cat "$JD_DIR/state/deployed-tag")" = "$TAG"
check "and still answers" test "$(get "$(url /api/health)")" = 200

echo "== Rollback (P4-DEPLOY-02)"
for name in app worker collab migrator ops; do docker tag "$REG/$name:$TAG" "$REG/$name:$TAG-next"; done
bash "$ROOT/ops/deploy.sh" "$TAG-next"
check "the next version is deployed" test "$(cat "$JD_DIR/state/deployed-tag")" = "$TAG-next"
bash "$JD_DIR/current/ops/rollback.sh"
check "rollback brings back the previous version" test "$(cat "$JD_DIR/state/deployed-tag")" = "$TAG"
check "and it answers" test "$(get "$(url /api/health)")" = 200

echo "== Recovery command (P4-DRILL-02)"
check "reset-ip-rules runs" bash "$JD_DIR/current/ops/admin.sh" reset-ip-rules 203.0.113.0/24

echo "== Backups (P4-BACKUP-01, -03) and restore (P4-BACKUP-02)"
psql() { JDSHEETS_TAG="$TAG" docker compose -p jdsheets --env-file "$JD_DIR/.env.production" \
  -f "$JD_DIR/current/docker-compose.prod.yml" exec -T db psql -U jdsheets -d jdsheets -tAc "$1"; }
docker run --rm -v jdsheets_workbooks:/data alpine:3.22 \
  sh -c 'mkdir -p /data/ci && echo marker-cell-value-4711 > /data/ci/marker.txt'
USERS_BEFORE="$(psql 'select count(*) from identity_users')"
RULES_BEFORE="$(psql 'select count(*) from network_ip_rules')"
bash "$JD_DIR/current/ops/backup.sh"
FIRST="$(find "$WORK/drive" -name 'jdsheets-*.tar.gpg' | head -n 1)"
check "a backup reached the stand-in for Google Drive" test -s "$FIRST"
check "it holds no readable workbook text or email" bash -c '! grep -qa -e marker-cell-value-4711 -e admin@jdfusion.in "$1"' _ "$FIRST"
check "a wrong passphrase cannot open it" bash -c '! gpg --batch --pinentry-mode loopback --passphrase wrong -d "$1" >/dev/null 2>&1' _ "$FIRST"
touch -d '10 days ago' "$JD_DIR/backups/jdsheets-20000101-000000.tar.gpg"
touch -d '40 days ago' "$WORK/drive/jdsheets-20000101-000000.tar.gpg"
sleep 1
bash "$JD_DIR/current/ops/backup.sh"
check "local copies older than 7 days are removed" test ! -e "$JD_DIR/backups/jdsheets-20000101-000000.tar.gpg"
check "Drive copies older than 30 days are removed" test ! -e "$WORK/drive/jdsheets-20000101-000000.tar.gpg"
psql 'delete from network_ip_rules' >/dev/null
docker run --rm -v jdsheets_workbooks:/data alpine:3.22 rm -rf /data/ci
JD_YES=1 bash "$JD_DIR/current/ops/restore.sh" --from-drive
check "restore brings back the users" test "$(psql 'select count(*) from identity_users')" = "$USERS_BEFORE"
check "restore brings back the network rules" test "$(psql 'select count(*) from network_ip_rules')" = "$RULES_BEFORE"
check "restore brings back the workbook files" test "$(docker run --rm -v jdsheets_workbooks:/data:ro alpine:3.22 cat /data/ci/marker.txt)" = marker-cell-value-4711
check "the app answers after the restore" test "$(get "$(url /api/health)")" = 200
: >"$ALERT_OUTBOX"
touch "$WORK/not-a-folder"
sed -i "s|^BACKUP_REMOTE=.*|BACKUP_REMOTE=\"$WORK/not-a-folder/drive\"|" "$JD_DIR/.env.production"
check "a backup that cannot reach Drive fails" bash -c '! bash "$1/current/ops/backup.sh"' _ "$JD_DIR"
check "and sends an alert (P4-BACKUP-03)" grep -q "Backup FAILED" "$ALERT_OUTBOX"
sed -i "s|^BACKUP_REMOTE=.*|BACKUP_REMOTE=\"$WORK/drive\"|" "$JD_DIR/.env.production"

echo "== Health alerts (P4-OBS-01)"
export WATCH_CERT_HOST=127.0.0.1:8443
watch() { bash "$JD_DIR/current/ops/watch.sh" >/dev/null; }
alerts() { grep -c "^Subject: \[JD Sheets\] $1" "$ALERT_OUTBOX" || true; }
: >"$ALERT_OUTBOX"
watch
check "no alert when everything is fine" test "$(grep -c '^Subject:' "$ALERT_OUTBOX" || true)" = 0
docker stop jdsheets-worker-1 >/dev/null
watch
watch
check "a stopped container sends one alert, not one per check" test "$(alerts 'PROBLEM: worker')" = 1
WATCH_DISK_PERCENT=1 watch
check "a full disk sends an alert" test "$(alerts 'PROBLEM: disk')" = 1
WATCH_CERT_DAYS=4000 watch
check "a certificate near its end sends an alert" test "$(alerts 'PROBLEM: certificate')" = 1
date -u -d '2 days ago' +%Y-%m-%dT%H:%M:%SZ >"$JD_DIR/state/last-backup-ok"
watch
check "an old backup sends an alert" test "$(alerts 'PROBLEM: backup')" = 1
JDSHEETS_TAG="$TAG" docker compose -p jdsheets --env-file "$JD_DIR/.env.production" \
  -f "$JD_DIR/current/docker-compose.prod.yml" up -d --wait worker
date -u +%Y-%m-%dT%H:%M:%SZ >"$JD_DIR/state/last-backup-ok"
watch
for what in worker disk certificate backup; do
  check "one 'resolved' mail for $what" test "$(alerts "Resolved: $what")" = 1
done

if [ "${#problems[@]}" -gt 0 ]; then
  printf '\nStack check FAILED:\n'
  printf '  - %s\n' "${problems[@]}"
  exit 1
fi
echo
echo "Stack check passed"
