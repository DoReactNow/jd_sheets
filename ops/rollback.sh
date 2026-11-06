#!/usr/bin/env bash
# Starts the previous version again (P4-DEPLOY-02). Migrations are backward compatible
# (Decision 30), so the database is left as it is. Usage: ops/rollback.sh [tag]
source "$(dirname "$0")/lib.sh"
require_root

TARGET="${1:-$(previous_tag)}"
[ -n "$TARGET" ] || fail "no previous version is recorded; name one: rollback.sh <tag>"
say "Rolling back from $(deployed_tag) to $TARGET"
exec "$(dirname "$0")/deploy.sh" "$TARGET" --no-migrate
