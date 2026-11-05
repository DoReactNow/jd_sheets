# Local Environment Setup Guide: JD Sheets

How to run JD Sheets on a developer machine (macOS, Linux, or Windows with WSL2). Everything here is **planned**; W-017 (the fresh-clone drill) checks it against reality and fixes every difference.

Always use `127.0.0.1`, never `localhost` (Decision 27).

| Thing | Address |
|:---|:---|
| App (Next.js dev) | `http://127.0.0.1:47320` |
| Rust collab service | `http://127.0.0.1:47321` |
| Postgres | `127.0.0.1:47322` |
| Full stack through Caddy (Docker) | `http://127.0.0.1:47324` |
| GridCraft standalone (first look only) | `http://127.0.0.1:47325` |

---

## 1. Prerequisites

| Tool | Version | Why |
|:---|:---|:---|
| Git | any recent | submodule for GridCraft |
| Node.js | 22.12 or newer (`.nvmrc`) | app, worker, tests (pg-boss needs 22.12+) |
| npm | 10+ | |
| Docker Desktop (or Docker Engine + Compose) | recent | Postgres, full stack |
| rustup | any | installs the pinned Rust toolchain from `services/collab/rust-toolchain.toml` |
| Rust toolchain | pinned (1.95 at writing, GridCraft's minimum) | Rust service and the editor build |
| `wasm32-unknown-unknown` target | via rustup | editor (WebAssembly) |
| trunk | pinned in W-001 | builds GridCraft's web app |

macOS note (checked 2026-11-06 on the owner's Mac): `rustup` is installed through Homebrew but no toolchain is active yet, and `cargo`/`trunk` are not on the `PATH`. `npm run setup:rust` installs the toolchain and trunk; make sure `~/.cargo/bin` is on the `PATH` (add `export PATH="$HOME/.cargo/bin:$PATH"` to `~/.zshrc`).

---

## 2. Quick Start (fresh clone)

```bash
git clone --recurse-submodules <repo-url> jd-sheets
cd jd-sheets
```

```bash
cp .env.example .env
cp .env.test.example .env.test
```

```bash
npm ci
```

```bash
npm run setup:rust
```

```bash
npm run editor:build
```

```bash
docker compose -f docker/docker-compose.local.yml up -d db
```

```bash
npm run db:migrate:deploy && npm run db:sync-rbac && npm run db:seed:dev
```

```bash
npm run db:test:prepare
```

```bash
npm run dev:all
```

Then open `http://127.0.0.1:47320`.

`dev:all` starts the app, the worker and the Rust service together with labelled output. Separately: `npm run dev`, `npm run worker:dev`, `npm run collab:dev`.

Before the first E2E run on a machine:

```bash
npx playwright install chromium
```

The first `editor:build` compiles GridCraft to WebAssembly and takes several minutes; later builds are faster. W-002 records the real time and bundle size here.

---

## 3. Environment Files

### `.env.example` → `.env` (development)

```dotenv
# Environment
APP_ENV="development"
APP_URL="http://127.0.0.1:47320"
APP_PORT="47320"

# Database (local Docker Postgres, DEV database)
DATABASE_URL="postgresql://jdsheets:jdsheets@127.0.0.1:47322/jdsheets_dev"

# Phase 0 only: run every request as the development principal (refused outside development/test)
DEV_PRINCIPAL="on"

# Network rules (Phase 1+). Off by default in development.
NETWORK_ENFORCEMENT="off"
TRUSTED_PROXY_HOPS="0"
BOOTSTRAP_ALLOWED_CIDRS="127.0.0.1/32,::1/128"

# Rust collab service
COLLAB_URL="http://127.0.0.1:47321"
COLLAB_PORT="47321"
# Dev-only placeholders; production refuses these values.
COLLAB_TOKEN_SECRET="dev-only-collab-secret-change-me-0123456789"
INTERNAL_SERVICE_TOKEN="dev-only-internal-token-change-me-0123456789"

# Workbook validation: "collab" (real engine) or "fake"
WORKBOOK_VALIDATOR="collab"

# File storage
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="./storage/dev"

# Mail (OTP only, Phase 1+). Development always uses the fake sender.
MAIL_DRIVER="fake"

# Sessions and OTP (Phase 1+). Dev-only placeholders.
OTP_PEPPER="dev-only-otp-pepper-change-me-0123456789"
```

### `.env.test.example` → `.env.test` (tests only)

```dotenv
APP_ENV="test"
APP_URL="http://127.0.0.1:47330"
APP_PORT="47330"

# Must end in _test; the app and the Rust service refuse anything else.
DATABASE_URL="postgresql://jdsheets:jdsheets@127.0.0.1:47322/jdsheets_test"

DEV_PRINCIPAL="off"
NETWORK_ENFORCEMENT="off"      # network tests turn it on themselves
TRUSTED_PROXY_HOPS="1"

COLLAB_URL="http://127.0.0.1:47331"
COLLAB_PORT="47331"
COLLAB_TOKEN_SECRET="test-only-collab-secret-0123456789abcdef"
INTERNAL_SERVICE_TOKEN="test-only-internal-token-0123456789abcdef"

WORKBOOK_VALIDATOR="fake"      # contract and E2E tests start the real service
STORAGE_DRIVER="local"
STORAGE_LOCAL_DIR="./storage/test"
MAIL_DRIVER="fake"
OTP_PEPPER="test-only-otp-pepper-0123456789abcdef"

# Throwaway credentials used only by prisma/seed-test.ts and the tests (Phase 1+)
TEST_SUPER_ADMIN_PASSWORD="test-Password-123!"
TEST_ADMIN_PASSWORD="test-Password-123!"
TEST_MEMBER_PASSWORD="test-Password-123!"
```

### `.env.production.example` → `.env.production` (on the server only)

```dotenv
APP_ENV="production"
APP_URL="https://<domain>"
DATABASE_URL="postgresql://<user>:<password>@db:5432/jdsheets"   # must NOT end in _test

DEV_PRINCIPAL="off"                  # "on" is refused
NETWORK_ENFORCEMENT="on"             # "off" is refused
TRUSTED_PROXY_HOPS="1"               # Caddy in front
EDGE_ALLOWED_CIDRS="<office CIDRs, comma-separated>"
BOOTSTRAP_ALLOWED_CIDRS="<office CIDRs, comma-separated>"

COLLAB_URL="http://collab:47321"
# Generate each with: openssl rand -base64 48
COLLAB_TOKEN_SECRET="<random>"
INTERNAL_SERVICE_TOKEN="<random>"
OTP_PEPPER="<random>"

WORKBOOK_VALIDATOR="collab"          # "fake" is refused
STORAGE_DRIVER="local"               # or "s3"
STORAGE_LOCAL_DIR="/data/workbooks"

MAIL_DRIVER="smtp"                   # "fake" is refused
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="465"
SMTP_USER="<sending address>"
SMTP_PASSWORD="<Google app password>"
MAIL_FROM="JD Sheets <sending address>"

# Only for the first run of the private seed; remove afterwards
SEED_SUPER_ADMIN_EMAIL="<name>@jdfusion.in"
SEED_SUPER_ADMIN_PASSWORD="<strong password>"
```

The Rust service reads the same variables it needs (`APP_ENV`, `DATABASE_URL`, `COLLAB_PORT`, `COLLAB_TOKEN_SECRET`, `INTERNAL_SERVICE_TOKEN`, `APP_URL`) and applies the same refusals.

---

## 4. Databases in Docker

One Postgres 17 container with two databases: `jdsheets_dev` and `jdsheets_test` (created by `docker/postgres/init/01-create-test-db.sql`).

```bash
npm run db:up
```

Same as:

```bash
docker compose -f docker/docker-compose.local.yml up -d db
```

Check both exist:

```bash
docker compose -f docker/docker-compose.local.yml exec db psql -U jdsheets -c '\l'
```

---

## 5. GridCraft, Patches and the Editor Build

- GridCraft is the submodule at `vendor/gridcraft`, pinned to a release tag (`vendor/GRIDCRAFT_VERSION`). **Never edit it.**
- `npm run editor:build` copies it to `.build/gridcraft`, applies `patches/gridcraft/*.patch` in order, runs `trunk build --release` with `public_url = "/editor/"`, and writes `public/editor/` with `build-info.json`.
- Run `editor:build` again after: cloning, pulling a submodule bump, or changing a patch.
- Standalone look at plain GridCraft: `npm run editor:serve` → `http://127.0.0.1:47325`.

Update the submodule after pulling:

```bash
git submodule update --init --recursive
```

Check that nobody edited the vendored source:

```bash
npm run vendor:check
```

---

## 6. The Rust Service

```bash
npm run collab:dev
```

This runs `cargo run` in `services/collab` with `.env`. Checks:

```bash
npm run rust:check
```

```bash
npm run rust:test
```

Rust integration tests use `.env.test` and the `jdsheets_test` database.

---

## 7. Migrations

Create and apply a migration in development after editing `prisma/schema.prisma`:

```bash
npm run db:migrate:dev -- --name <snake_case_name>
```

Apply existing migrations to the test database:

```bash
npm run db:test:migrate
```

Check that the schema and the migration history agree (CI runs this):

```bash
npm run db:migrate:check
```

Wipe the development database and re-apply everything (destroys development data):

```bash
npm run db:reset:dev
```

---

## 8. Seeding

| Command | Database | What |
|:---|:---|:---|
| `npm run db:sync-rbac` | any | roles and permissions (Phase 1+), idempotent |
| `npm run db:seed:dev` | development | sample workbooks; development users from Phase 1 |
| `npm run db:test:prepare` | test | migrate + sync + test seed |
| `npm run db:seed:private` | production | first Super Admin and bootstrap IP rules (reads `prisma/private/seed.ts`, git-ignored) |

Recovery commands (on the server, Phase 1+):

```bash
npm run admin:reset-super-admin -- --email <name>@jdfusion.in
```

```bash
npm run admin:reset-ip-rules -- --cidr <cidr>
```

---

## 9. Tests

| Command | What |
|:---|:---|
| `npm run test:unit` | Vitest unit tests |
| `npm run test:integration` | Vitest integration tests against `jdsheets_test` |
| `npm run test:contract` | TS side of the contracts (token, bridge, storage, mail, validator) |
| `npm run rust:test` | Rust unit, integration, contract and property tests |
| `npm run test:e2e` | Playwright against the built app, the real editor and the real Rust service, with fakes for mail |
| `npm run ci:quality` | everything CI runs for TypeScript, in CI order |
| `npm run rust:ci` | fmt check, clippy `-D warnings`, build, tests |

Run the whole suite locally before a pull request:

```bash
npm run ci:quality && npm run rust:ci
```

---

## 10. Docker: Local Full Stack (optional)

Runs Caddy, app, worker, collab and Postgres in containers, as in production:

```bash
docker compose -f docker/docker-compose.local.yml --profile full up -d --build
```

Open `http://127.0.0.1:47324`.

Reset local Docker data (destroys local databases and files):

```bash
docker compose -f docker/docker-compose.local.yml down -v
```

---

## 11. Command Reference (planned script set)

| Script | Does |
|:---|:---|
| `dev` | Next.js dev server on 47320 |
| `dev:all` | app + worker + collab together |
| `worker:dev` | worker with reload |
| `collab:dev` | Rust service with `.env` |
| `build` · `build:worker` · `start` | production builds and start |
| `lint` | ESLint + `lint:arch` + SSOT scan + `vendor:check` |
| `lint:arch` | dependency-cruiser boundaries |
| `typecheck` | `tsc --noEmit` |
| `setup:rust` | install the pinned toolchain, wasm target and trunk |
| `editor:build` · `editor:serve` | build GridCraft + patches to `public/editor/`; serve it standalone on 47325 |
| `vendor:check` | fail if `vendor/gridcraft` differs from the pinned commit |
| `rust:check` · `rust:build` · `rust:test` · `rust:ci` | Rust checks |
| `db:up` · `db:migrate:dev` · `db:migrate:deploy` · `db:test:migrate` · `db:migrate:check` · `db:generate` · `db:reset:dev` | database |
| `db:sync-rbac` · `db:seed:dev` · `db:test:prepare` · `db:seed:private` | seeds |
| `admin:reset-super-admin` · `admin:reset-ip-rules` | recovery (Phase 1+) |
| `test:unit` · `test:integration` · `test:contract` · `test:e2e` | tests |
| `ci:quality` | TS CI chain |

---

## 12. Troubleshooting

| Problem | Fix |
|:---|:---|
| `cargo: command not found` | Add `~/.cargo/bin` to `PATH`, then `npm run setup:rust` |
| `trunk: command not found` | `npm run setup:rust` (installs the pinned trunk) |
| The editor page is blank | Run `npm run editor:build`; check `public/editor/build-info.json` exists; check the browser console for a WebGPU/WebGL message |
| "temporarily unavailable" when saving | The Rust service is not running: `npm run collab:dev` (or set `WORKBOOK_VALIDATOR="fake"` for UI-only work) |
| A patch does not apply | The submodule moved without the patch being refreshed; see `patches/gridcraft/README.md` |
| Tests refuse to start | `.env.test` must point to a database ending in `_test` |
| Port already in use | Another JD Sheets or Explore Hills process; Explore Hills uses the 47210s, JD Sheets the 47320s |
