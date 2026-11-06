#!/usr/bin/env bash
# Deploys one version (P4-DEPLOY-01, -02). Usage:
#   ops/deploy.sh <tag>               migrations first, then the new containers
#   ops/deploy.sh <tag> --no-migrate  used by rollback.sh (migrations are backward compatible)
# A failed migration stops here and the running version keeps serving. If the new containers do
# not turn healthy, the previous version is started again.
source "$(dirname "$0")/lib.sh"
require_root

TAG="${1:-}"
MIGRATE=1
[ "${2:-}" = "--no-migrate" ] && MIGRATE=0
[ -n "$TAG" ] || fail "usage: deploy.sh <tag>"
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || fail "not a valid tag: $TAG"
[ -f "$JD_ENV" ] || fail "$JD_ENV is missing; run ops/setup.sh first"
mkdir -p "$JD_STATE"

CURRENT="$(deployed_tag)"
say "Deploying $TAG (running now: ${CURRENT:-nothing})"
fetch_release "$TAG"

if [ -n "$CURRENT" ] && [ -x "$JD_DIR/releases/$TAG/ops/backup.sh" ] && [ "$MIGRATE" = 1 ]; then
  say "Backup before the update (kept on this server)"
  "$JD_DIR/releases/$TAG/ops/backup.sh" --local-only || fail "the backup failed, so nothing was changed"
fi

if [ "$MIGRATE" = 1 ]; then
  say "Database changes (migrations)"
  compose_for "$TAG" up -d --wait db
  if ! compose_for "$TAG" --profile migrate run --rm migrator; then
    fail "the database changes failed; ${CURRENT:-nothing} is still running, unchanged"
  fi
  ok "migrations applied"
fi

say "Starting $TAG"
if compose_for "$TAG" up -d --wait --wait-timeout 300 --remove-orphans; then
  if [ -n "$CURRENT" ] && [ "$CURRENT" != "$TAG" ]; then echo "$CURRENT" >"$JD_STATE/previous-tag"; fi
  echo "$TAG" >"$JD_STATE/deployed-tag"
  ln -sfn "releases/$TAG" "$JD_DIR/current"
  ok "$TAG is running and healthy"
else
  compose_for "$TAG" ps || true
  if [ -n "$CURRENT" ] && [ "$CURRENT" != "$TAG" ]; then
    say "$TAG did not turn healthy; starting $CURRENT again"
    compose_for "$CURRENT" up -d --wait --wait-timeout 300 --remove-orphans ||
      fail "$CURRENT did not start either; see runbook.md, 'When things go wrong'"
    fail "$TAG did not turn healthy; $CURRENT is running again"
  fi
  fail "$TAG did not turn healthy (see: docker compose -p $JD_PROJECT logs)"
fi

# Keep the files and images of the three newest versions (and always the previous one).
say "Tidying old versions"
PREV="$(previous_tag)"
count=0
while IFS= read -r dir; do
  name="$(basename "$dir")"
  count=$((count + 1))
  if [ "$count" -le 3 ] || [ "$name" = "$TAG" ] || [ "$name" = "$PREV" ]; then continue; fi
  rm -rf "$dir"
  for image in "${JD_IMAGES[@]}"; do docker rmi -f "$(registry)/$image:$name" >/dev/null 2>&1 || true; done
  ok "removed old version $name"
done < <(ls -1dt "$JD_DIR"/releases/*/ 2>/dev/null | sed 's:/$::')
say "Done: $TAG is live"
