#!/usr/bin/env bash
# One-off commands, run in the migrator image of the deployed version (it holds the sources).
#   ops/admin.sh first-run                     roles, the first network rules, the first Super Admin
#   ops/admin.sh reset-super-admin <email>     new password, asked here (P4-DRILL-02)
#   ops/admin.sh reset-ip-rules <cidr>         replaces every network rule with one (P4-DRILL-02)
#   ops/admin.sh sync-rbac                     roles and permissions, after a deploy that adds some
source "$(dirname "$0")/lib.sh"
require_root

TAG="$(deployed_tag)"
[ -n "$TAG" ] || fail "nothing is deployed yet; run ops/deploy.sh <tag> first"
# -T: these commands never read the terminal, so they cannot swallow what is typed next.
run() { compose_for "$TAG" --profile migrate run --rm -T "$@" migrator npx tsx "${CMD[@]}" </dev/null; }
run_interactive() { compose_for "$TAG" --profile migrate run --rm -it migrator npx tsx "${CMD[@]}"; }

case "${1:-}" in
  sync-rbac)
    CMD=(src/modules/identity/identity.cli.ts sync-rbac)
    run
    ;;
  first-run)
    CMD=(src/modules/identity/identity.cli.ts sync-rbac)
    run
    echo "  The first Super Admin is $(env_value SEED_SUPER_ADMIN_EMAIL)."
    while :; do
      read -r -s -p "  Choose their password: " SEED_SUPER_ADMIN_PASSWORD
      echo
      read -r -s -p "  Again, to check: " again
      echo
      [ -n "$SEED_SUPER_ADMIN_PASSWORD" ] && [ "$SEED_SUPER_ADMIN_PASSWORD" = "$again" ] && break
      echo "  They differ or are empty; try again."
    done
    export SEED_SUPER_ADMIN_PASSWORD
    # Passed by name only: the password is never on a command line or in a file.
    CMD=(prisma/seed-private.ts)
    run -e SEED_SUPER_ADMIN_PASSWORD
    ;;
  reset-super-admin)
    [ -n "${2:-}" ] || fail "usage: admin.sh reset-super-admin <email>"
    CMD=(src/modules/identity/identity.cli.ts reset-super-admin --email "$2")
    run_interactive
    ;;
  reset-ip-rules)
    [ -n "${2:-}" ] || fail "usage: admin.sh reset-ip-rules <address or range>"
    CMD=(src/modules/network/network.cli.ts reset-ip-rules --cidr "$2")
    run
    ;;
  *) fail "usage: admin.sh first-run | sync-rbac | reset-super-admin <email> | reset-ip-rules <cidr>" ;;
esac
