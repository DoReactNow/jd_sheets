#!/usr/bin/env bash
# Shared helpers for the server scripts (Decision 61). Sourced, never run directly.
# Layout on the server (JD_DIR, default /opt/jdsheets):
#   .env.production          secrets and settings, root only (P4-SEC-05)
#   releases/<tag>/          the ops bundle of each deployed version (compose file, Caddyfile, ops/)
#   current -> releases/<tag>
#   state/deployed-tag, state/previous-tag
# Backup passphrase: JD_ETC (default /etc/jdsheets)/backup.pass, root only.
set -euo pipefail

JD_DIR="${JD_DIR:-/opt/jdsheets}"
JD_ETC="${JD_ETC:-/etc/jdsheets}"
JD_ENV="$JD_DIR/.env.production"
JD_STATE="$JD_DIR/state"
JD_PROJECT="${JD_PROJECT:-jdsheets}"
JD_IMAGES=(app worker collab migrator ops)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32mOK\033[0m  %s\n' "$*"; }
fail() {
  printf '\n\033[31mSTOPPED:\033[0m %s\n' "$*" >&2
  exit 1
}

# A value from .env.production (no secrets are printed by callers).
env_value() {
  local name="$1"
  [ -f "$JD_ENV" ] || return 0
  sed -n "s/^${name}=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" "$JD_ENV" | tail -n 1
}

registry() {
  local value
  value="$(env_value JDSHEETS_REGISTRY)"
  printf '%s' "${value:-ghcr.io/doreactnow/jd_sheets}"
}

deployed_tag() { cat "$JD_STATE/deployed-tag" 2>/dev/null || true; }
previous_tag() { cat "$JD_STATE/previous-tag" 2>/dev/null || true; }

# docker compose for one release: compose_for <tag> <compose args...>
compose_for() {
  local tag="$1"
  shift
  JDSHEETS_TAG="$tag" docker compose -p "$JD_PROJECT" --env-file "$JD_ENV" \
    -f "$JD_DIR/releases/$tag/docker-compose.prod.yml" "$@"
}

# The image exists here already, or can be pulled.
ensure_image() {
  local image="$1"
  docker image inspect "$image" >/dev/null 2>&1 || docker pull -q "$image" >/dev/null
}

# Pulls every image of a tag and unpacks its ops bundle into releases/<tag>.
fetch_release() {
  local tag="$1" reg name
  reg="$(registry)"
  for name in "${JD_IMAGES[@]}"; do
    ensure_image "$reg/$name:$tag" || fail "could not download $reg/$name:$tag (check the registry login)"
  done
  ok "images for $tag are here"
  local dir="$JD_DIR/releases/$tag"
  rm -rf "$dir.tmp"
  mkdir -p "$dir.tmp"
  docker run --rm "$reg/ops:$tag" | tar -x -C "$dir.tmp"
  ln -sf ../../.env.production "$dir.tmp/.env.production"
  rm -rf "$dir"
  mv "$dir.tmp" "$dir"
  ok "files for $tag unpacked in $dir"
}

require_root() {
  [ "$(id -u)" = "0" ] || [ "${JD_ALLOW_NON_ROOT:-}" = "1" ] || fail "run this as root"
}
