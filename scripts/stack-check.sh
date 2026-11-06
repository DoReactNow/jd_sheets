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
export JD_DIR="$WORK/jd" JD_ETC="$WORK/etc" JD_ALLOW_NON_ROOT=1 JD_PROJECT=jdsheets
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

if [ "${#problems[@]}" -gt 0 ]; then
  printf '\nStack check FAILED:\n'
  printf '  - %s\n' "${problems[@]}"
  exit 1
fi
echo
echo "Stack check passed"
