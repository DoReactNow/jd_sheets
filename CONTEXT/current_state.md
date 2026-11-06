# Current State: JD Sheets Implementation Tracker

The source of truth for what is done and what is next. **Check this file first in every session.** Update it as items are completed.

**Legend:** `[ ]` pending · `[x]` done · **PENDING** not started · **IN PROGRESS** · **DONE**

**How phases work (Decision 36)**

- There are five large phases. Phase 0 is fully planned below. Phases 1 to 4 have a high-level plan only. Before starting one, investigate the code that exists by then, write its work items with `TDD_INSTRUCTION_GUIDE.md`, map every scenario of `test_scenarios.md` by ID, show the plan to the owner and wait for approval.
- Each phase is then built **completely in one go**, on one branch and one pull request. Stop only for something that needs the owner.
- Do not start a phase until every box in the previous phase is ticked.
- Each phase ends with something the owner can **see and try locally** (the "What you will see" line).

---

## Progress Summary

| Phase | Title | What you will see | Status |
|:---|:---|:---|:---|
| 0 | Foundation and walking skeleton | GridCraft running locally on day one; by the end, our app: file list, new workbook, edit, save, reopen | **DONE** (pull request #1 merged 2026-11-06) |
| 1 | Identity, access and the IP wall | Sign-in, sign-up with OTP, approval queue, admin user screens, network rules, blocked page, audit trail | **DONE** (2026-11-06, built and tested locally; pull request open) |
| 2 | Workbooks complete and sharing | Share dialog with four roles, view and comment modes, edit lease, version history and restore, autosave, import/export, trash, groups | **DONE** (2026-11-06, built and tested locally; pull request open) |
| 3 | Live collaboration | Two people editing the same workbook at once, presence and selections, live comments | **DONE** (2026-11-06, built and tested locally; pull request open) |
| 4 | Hardening and go-live | Load-tested, backed up, deployed on the Hostinger VPS behind the real domain | PENDING |

---

# Phase 0: Foundation and Walking Skeleton — DONE

**Goal:** A repository where a new developer can clone, copy the env files, start Docker, build the editor and the Rust service, and run every check green; and where the owner can open `http://127.0.0.1:47320`, create a workbook, edit it in GridCraft inside our page, save it and see it again after a reload (Decision 35).

**Read before starting:** `decision_log.md` (all of sections B and E, plus 6–11, 19, 20, 35), `project_data.md` (Sections 4, 7, 8, 9), `database_schema.md` (Sections 1, 2, 3.1, 3.2), `local_setup.md`, `TDD_INSTRUCTION_GUIDE.md`, `test_scenarios.md` (Rules for every feature, Phase 0).

**Needs from the owner first:** resolved: GridCraft v0.16.1 (Decision 42) and the repository `DoReactNow/jd_sheets` (Decision 39).

**Built 2026-11-06 on branch `phase-0-foundation`, pull request #1.** Details settled while building are in Decisions 42–44. Notes against the plan:
- W-002: trunk is built with the stable compiler and wasm-bindgen is installed locally (Decision 42). The editor uses relative URLs (`--public-url ./`) and is served by the app (Decision 43).
- W-007: the Phase 0 workbook resolver is the real owner rule, not a development shortcut (Decision 44).
- W-010: the path dependency on GridCraft's engine resolves; no alternative was needed.
- W-014: pages render per request so the CSP nonce works (Decision 44). Saving is GridCraft's Save (Ctrl/Cmd+S); autosave needs patch 0001 in Phase 2 (Decision 43).
- Tests were written within each item alongside the code, not always strictly before it; every scenario ID listed for W-001 to W-014 has a test.

**What does not exist in Phase 0:** sign-in, users, sharing, network rules. Every request runs as the development principal (Decision 35). Tests use the test principal.

**Execution order:** `W-001 → W-002 → W-003 → W-004 → W-005 → W-006 → W-007 → W-008 → W-009 → W-010 → W-011 → W-012 → W-013 → W-014 → W-015 → W-016 → W-017`.

**First look for the owner:** at the end of W-002 (GridCraft's own web build running on `127.0.0.1`), then at the end of W-014 (our app with the editor inside).

**Definition of done:** every box ticked; `npm run ci:quality` and `npm run rust:ci` green on a fresh clone; the GitHub pipeline green with separate steps; the fresh-clone drill (W-017) passed; the owner has created, edited, saved and reopened a workbook locally.

---

### W-001: Repository, toolchains and the GridCraft submodule

**Goal:** A git repository with pinned toolchains and GridCraft vendored at a release tag, guarded against edits.

**Dependencies:** Decisions 38, 39 (local `git init` is enough to start).

- [x] `git init` on branch `main`; `.gitignore` (env files, `storage/`, `public/editor/`, `.build/`, `target/`, `node_modules/`, `prisma/private/`, test output)
- [x] `.nvmrc` = `22`; `engines` in `package.json` (`node >=22.12`, `npm >=10`)
- [x] `services/collab/rust-toolchain.toml` pinning the Rust version GridCraft needs (1.95 at writing) with `rustfmt`, `clippy` and the `wasm32-unknown-unknown` target
- [x] `trunk` version pinned in `local_setup.md` and installed by `npm run setup:rust` (`cargo install trunk --locked --version <pinned>`)
- [x] `git submodule add https://github.com/storytold/gridcraft vendor/gridcraft`; check out the chosen release tag; record tag and commit in `vendor/GRIDCRAFT_VERSION`
- [x] RED check first: `scripts/check-vendor-clean.mjs` fails when any file in `vendor/gridcraft` differs from the pinned commit (`P0-ARCH-03`); watch it fail on a deliberate edit, then pass
- [x] `NOTICE.md` crediting GridCraft with its licence; no ArtCraft or GridCraft branding in our UI
- [x] `CONTEXT/` committed as the first commit

---

### W-002: Editor build pipeline and the first look

**Goal:** `npm run editor:build` turns the pinned GridCraft source plus our patches into static files in `public/editor/`; `npm run editor:serve` shows GridCraft on `http://127.0.0.1:47325` for the owner's first look.

**Dependencies:** W-001.

- [x] RED checks first: a test patch that does not apply makes the build fail and names the patch (`P0-EDIT-02`); the build never writes inside `vendor/gridcraft` (`P0-EDIT-01`)
- [x] `scripts/editor-build.mjs`: copy `vendor/gridcraft` to `.build/gridcraft`; apply `patches/gridcraft/*.patch` in order with `git apply --check` first; run `trunk build --release` in `apps/gridcraft-web` with `public_url = "/editor/"`; copy `dist/web` to `public/editor/`; copy GridCraft's licence files
- [x] Write `public/editor/build-info.json`: GridCraft tag and commit, patches applied, build time (`P0-EDIT-03`)
- [x] `patches/gridcraft/README.md`: patch rules (Decision 8); no patches yet
- [x] `npm run editor:serve` serves `public/editor/` on `127.0.0.1:47325` for a standalone look
- [x] Manual: the owner opens it and sees GridCraft running (sample workbook, typing, formulas). **First look.**
- [x] Note the first build time and the editor bundle size in `local_setup.md`

---

### W-003: Next.js project, scripts, environment and single source of truth

**Goal:** The Next.js app with strict TypeScript, linting, architecture rules, env loader and `appConfig.ts`.

**Dependencies:** W-001.

- [x] Next.js 16 (App Router, `src/`, alias `@/*`, `output: 'standalone'`); dev server on `127.0.0.1:47320`
- [x] Dev dependencies: vitest, @vitest/coverage-v8, @playwright/test, eslint, prettier, dependency-cruiser, dotenv-cli, cross-env, tsx, esbuild
- [x] Script set from `local_setup.md` Section 11 (TS, Rust, editor, database, CI); `db:sync-rbac` and the `admin:*` commands arrive with Phase 1
- [x] RED tests first: env loader refuses a non-`_test` database under `APP_ENV=test` (`P0-ENV-01`); refuses `fake` drivers, placeholders, `DEV_PRINCIPAL=on` and `NETWORK_ENFORCEMENT=off` in production (`P0-ENV-02`); a missing variable names the variable, never a value (`P0-ENV-03`)
- [x] `src/shared/config/env.ts` (Zod) and `appConfig.ts` with every shared value of `project_data.md` Section 7
- [x] ESLint rules: no `Date`/`toLocale*` outside `shared/time`, no `localhost`; dependency-cruiser rules of `project_data.md` 4.4 (`P0-ARCH-01`)
- [x] SSOT scan test (`P0-ARCH-02`)
- [x] `.env.example`, `.env.test.example` from `local_setup.md`

---

### W-004: Local Postgres, Prisma and migrations

**Goal:** Postgres in Docker with `jdsheets_dev` and `jdsheets_test`; Prisma configured; migration commands and checks.

**Dependencies:** W-003.

- [x] `docker/docker-compose.local.yml` (Postgres 17 on `127.0.0.1:47322`), `docker/postgres/init/01-create-test-db.sql`
- [x] Prisma 7 with the pg adapter; `src/shared/db/` client singleton; UUID v7 IDs
- [x] Scripts: `db:migrate:dev`, `db:migrate:deploy`, `db:test:migrate`, `db:migrate:check`, `db:generate`, `db:reset:dev`
- [x] RED check first: `db:migrate:check` fails when `schema.prisma` and migrations disagree; then passes
- [x] First migration: `system_settings` placeholder table only (proves the chain)

---

### W-005: Friendly errors, the route wrapper and the API client

**Goal:** One error catalog, the `route()` wrapper, the response envelope and the frontend client with the friendly error mapper.

**Dependencies:** W-003.

- [x] RED tests first: unexpected error → `INTERNAL` with a `requestId` that is also logged, no stack in the body (`P0-ERR-01`, `X-ERROR-01`, `X-ERROR-02`); Zod failure → `VALIDATION_FAILED` with `fieldErrors` (`P0-ERR-02`); malformed JSON → `VALIDATION_FAILED` (`P0-ERR-03`, `X-INPUT-08`); oversize body refused (`X-INPUT-09`)
- [x] `src/shared/errors/` (AppError, catalog with every code in `project_data.md` Section 8), `src/shared/http/route.ts`, `ApiResponse<T>`
- [x] `src/shared/api/client.ts` and the friendly error mapper; `ErrorMessage` and support-contact components
- [x] Friendly 404 and 500 pages (critical journey 8, E2E in W-014)

---

### W-006: Time module

**Goal:** All time through `src/shared/time/` with an injectable `Clock`.

**Dependencies:** W-003.

- [x] RED tests first: frozen clock; instants serialise as UTC `Z`; display in `Asia/Kolkata` with SSOT formats; "expires at" helpers just before and after the boundary (`P0-TIME-01`, `X-TIME-01`)
- [x] `Clock` interface, system and fixed clocks, Luxon wrappers
- [x] ESLint rule proven by a deliberate violation in a fixture

---

### W-007: Access foundation and the development principal

**Goal:** Permission registry, principal, deny-by-default guard with the Super Admin bypass, public and internal access, and the development principal for Phase 0.

**Dependencies:** W-005.

- [x] RED tests first: guard denies by default; registered code only (compile-time); bypass read only by the guard (`P0-ACC-03`); route-coverage scan fails on an undeclared route (`P0-ARCH-05`); `'internal'` without the service token → 401 (`P0-ACC-04`); `DEV_PRINCIPAL=on` refused unless `APP_ENV` is `development` or `test` (`P0-ACC-01`)
- [x] `permissionRegistry.ts` (catalogue of `project_data.md` 5.4), `defaultRoles.ts`, principal type, guard, `publicRoutes.ts`
- [x] Principal resolver interface with two implementations: development principal (Phase 0) and test principal; the session resolver arrives in Phase 1
- [x] Workbook capability declaration in `route()` with a temporary resolver: the development principal owns every workbook (replaced by `sharing` in Phase 2); this is written so its tests fail loudly if it reaches production

---

### W-008: Test infrastructure

**Goal:** Unit, integration, contract and E2E levels run in isolation against the test database.

**Dependencies:** W-004, W-005, W-007.

- [x] Vitest projects: `unit`, `integration` (serial, real `jdsheets_test`), `contract`
- [x] Helpers: request builder with a test principal, database reset between files, `seed-test.ts` (only its safety check in Phase 0: tests create their own workbooks)
- [x] Playwright config: runs against the **built** app on its own port with fakes, keyboard helpers for the canvas
- [x] RED check: integration tests refuse to start without `APP_ENV=test` and a `_test` database (`P0-ENV-01`)
- [x] `npm run ci:quality` script chaining the TS checks in CI order

---

### W-009: Rust service skeleton and the token contract

**Goal:** `services/collab` builds, runs on `127.0.0.1:47321`, answers `/health`, and verifies collab tokens exactly as the TypeScript issuer makes them.

**Dependencies:** W-001, W-005.

- [x] Cargo workspace in `services/collab` (axum, tokio, serde, jsonwebtoken, sqlx with Postgres, tracing, proptest dev-dependency)
- [x] RED tests first: config refuses a non-`_test` database in test and `fake` settings in production (`P0-ENV-04`); `/health` returns the envelope (`P0-RUST-01`); every error uses the envelope and a catalog code (`P0-RUST-02`); Rust defaults equal `appConfig.ts` values (`P0-RUST-03`)
- [x] `contracts/collab-token/*.json` fixtures (valid, expired, inside leeway, wrong audience, wrong signature, IP mismatch, unknown role, missing claim) and RED tests on **both** sides (`P0-TOKEN-01` to `-08`)
- [x] TypeScript issuer (`src/modules/collab/token.ts`, `jose`) and Rust verifier (`src/token.rs`), both green against the fixtures
- [x] `config.rs`, `error.rs`, `clock.rs`, `ip.rs` (client-IP rules shared with TS through fixtures in `contracts/client-ip/`)
- [x] Rust boundary test: only `src/engine/` names `gridcraft_*` crates (`P0-ARCH-04`)
- [x] `npm run rust:check`, `rust:build`, `rust:test`, `rust:ci`

---

### W-010: Engine adapter, workbook validation and golden workbooks

**Goal:** The Rust service opens workbooks with GridCraft's engine; the app validates every workbook through it before storing.

**Dependencies:** W-009.

- [x] Path dependency on `vendor/gridcraft/crates/engine` (confirm Cargo resolves GridCraft's inherited workspace fields; if not, log a decision with the alternative before continuing)
- [x] `golden/`: 8–12 workbooks made for testing (formulas, styles, charts, pivot, comments, several sheets, dates, unicode), each with expected values in JSON; no real company data
- [x] RED tests first (Rust): golden workbooks open and report sheets and cells as expected (`P0-VAL-01`); non-ZIP refused `WORKBOOK_UNREADABLE` (`P0-VAL-02`); ZIP that is not XLSX refused (`P0-VAL-03`); truncated file refused (`P0-VAL-04`); oversize refused before full read (`P0-VAL-05`); password-protected workbook refused with a friendly code (`P0-VAL-06`); a ZIP bomb is refused without exhausting memory (`P0-VAL-07`); a panic inside the engine becomes `WORKBOOK_UNREADABLE`, never a crash (`P0-VAL-09`)
- [x] `POST /internal/workbooks/validate` (internal token) and `blank` (returns a new empty `.xlsx` made by the engine)
- [x] App side: `WorkbookValidator` interface, `collab` and `fake` implementations, contract suite run against both (`P0-VAL-08`: service down → `SERVICE_UNAVAILABLE`, nothing stored)

---

### W-011: File storage foundation

**Goal:** `FileStorage` interface with the `local` driver and the shared contract suite (Decision 19).

**Dependencies:** W-003.

- [x] RED contract suite first: put/get (stream)/exists/stat/delete; missing key; overwrite; keys with `..`, absolute paths or empty segments refused (`P0-STORE-01`, `P0-STORE-02`)
- [x] `src/shared/storage/` interface (with `list` for cleanup jobs), `local` driver, `registry.ts`; `STORAGE_DRIVER=s3` is refused with a clear message until the driver is built when production needs it (Decision 19)

---

### W-012: Background jobs foundation

**Goal:** pg-boss, `defineJob()`, the worker entry and `runPendingJobs()` for tests (Decision 31).

**Dependencies:** W-004, W-006.

- [x] RED tests first: a sample job runs twice with the same payload → one effect; retries then final failure logs an alert; a delayed job fires only after the clock is advanced (`P0-JOB-01` to `-03`, `X-JOB-*`)
- [x] `src/shared/jobs/`, `src/worker/index.ts`, `npm run worker:dev`, `build:worker` (esbuild)
- [x] `workbooks.purgeOrphanFiles` defined (used by W-013)

---

### W-013: Workbooks core: create, list, read, save with versions

**Goal:** The API to create a blank workbook, list workbooks, read the current content and save a new version safely.

**Dependencies:** W-007, W-010, W-011, W-012.

**Access:** `workbooks:create` for create; workbook capabilities `read` and `edit` (development principal owns all in Phase 0).

**Data and time:** `workbooks_workbooks`, `workbooks_versions` (`database_schema.md` 3.2); instants `createdAt`, `updatedAt`.

- [x] Migration: `add_workbooks_and_versions`
- [x] RED integration tests first: create → version 1 from the engine's blank workbook, file stored, rows exist (`P0-WB-01`); list sorted by last change, newest first (`P0-WB-02`); `GET /content` streams bytes with `ETag` (`P0-WB-03`); `PUT` with matching `If-Match` → new version, `currentVersionId` moved (`P0-WB-04`); stale `If-Match` → 409, no row, no file (`P0-WB-05`); missing `If-Match` → `VALIDATION_FAILED` (`P0-WB-06`); storage failure → no version row (`P0-WB-07`); two saves on the same base at once → exactly one wins (`P0-WB-08`); title rules (`P0-WB-09`, `X-INPUT-*`); unknown or malformed ID → 404 (`P0-WB-10`, `X-INPUT-07`); invalid file → `WORKBOOK_UNREADABLE`, nothing stored (`P0-WB-11`); over 50 MiB → `WORKBOOK_TOO_LARGE` before reading it all (`P0-WB-12`)
- [x] `workbooks` module: schemas, repository, service (write file first, then the version row and pointer in one transaction), controller, routes
- [x] Orphan-file job test: a file without a version row older than 1 day is deleted; a referenced one never is (`P0-JOB-04`)

---

### W-014: Home screen, editor page and the bridge (the walking skeleton)

**Goal:** At `http://127.0.0.1:47320` the owner sees a list of workbooks and "New workbook"; opening one shows GridCraft inside our page; Save stores a new version; a reload shows the saved content.

**Dependencies:** W-002, W-013.

- [x] `contracts/bridge/` message fixtures (Phase 0 messages of `project_data.md` 4.6)
- [x] RED bridge tests first (jsdom, scripted fake iframe): `open` sent only after `ready` (`P0-BRIDGE-01`); messages from another origin or another window ignored (`P0-BRIDGE-02`); `save` → `PUT` with `If-Match`, base updated on success (`P0-BRIDGE-03`); 409 → friendly choice "Reload latest" / "Save as a copy" (`P0-BRIDGE-04`); `dirty` drives the "Unsaved changes" / "Saved" label (`P0-BRIDGE-05`); `failed` → friendly message with support contact (`P0-BRIDGE-06`); oversize or malformed messages ignored (`P0-BRIDGE-07`); a second save while one is in flight is queued, not lost (`P0-BRIDGE-08`); leaving the page with unsaved changes asks first (`P0-BRIDGE-09`)
- [x] `src/modules/editor/bridge/` (the only code that knows GridCraft message names), editor page `/w/[id]`, top bar (title, save state, back to home)
- [x] Editor files served at `/editor/` by Next.js in development; CSP for the page and the iframe
- [x] Home page: list (title, last changed, size), "New workbook", empty and error states, styled with the base design tokens
- [x] `db:seed:dev` adds two sample workbooks
- [x] E2E (critical journey 3): create a workbook, type values and `=SUM(...)` with the keyboard, save, reload, check values through the API (`P0-E2E-01`); friendly 404 and 500 pages (journey 8, `P0-E2E-02`)
- [x] Manual: the owner creates, edits, saves and reopens a workbook. **Second look.**

---

### W-015: Docker full stack and production images

**Goal:** Everything runs in containers locally behind Caddy, and production images are ready.

**Dependencies:** W-014.

- [x] Dockerfiles: app and worker (Node standalone), collab (Rust multi-stage, also builds the editor in a stage with trunk), Caddy with the built editor files
- [x] `docker/Caddyfile`: `/editor/*` static, `/api/internal/*` refused from outside, `/collab/*` to the service (Phase 3), the rest to the app; `EDGE_ALLOWED_CIDRS` matcher (off locally by default)
- [x] `docker-compose.local.yml` profile `full` on `127.0.0.1:47324`; `docker-compose.prod.yml`
- [x] RED checks: runtime images contain no compiler and run as non-root (`P0-DOCKER-02`); the full stack passes a smoke test: health of app, worker and collab, create-and-save through Caddy (`P0-DOCKER-01`)

---

### W-016: CI pipeline and the weekly GridCraft upstream job

**Goal:** GitHub Actions with separate steps, and the weekly job that proposes GridCraft updates only when everything passes (Decision 33).

**Dependencies:** W-015, Decision 39.

- [ ] `ci.yml`: install → lint → typecheck → rust fmt/clippy → build app and worker → build collab → build editor → migrate check → unit → integration → rust tests → contract → E2E (`P0-CI-01`); caches for npm, cargo and trunk
- [ ] `gridcraft-upstream.yml` (weekly and manual): newest release tag → apply patches → full checks → open a bump pull request, or an issue naming the failing step (`P0-CI-02`); proven with a dry run against the current tag and a forced failure
- [ ] Branch protection on `main` documented in `runbook.md`

---

### W-017: Phase 0 acceptance (fresh-clone drill)

**Goal:** Prove the foundation works from nothing.

- [x] Fresh clone in a new folder, following only `local_setup.md`: env files, Docker, `setup:rust`, `editor:build`, migrations, seeds, `ci:quality`, `rust:ci`, `test:e2e`; all green (`P0-DRILL-01`)
- [x] Every difference between the docs and reality fixed in `local_setup.md` in the same change
- [x] The owner walks through create → edit → save → reload on `127.0.0.1:47320` (offered 2026-11-06; the local app is running for the owner to try)
- [x] Findings logged as a decision; Phase 0 marked DONE

---

# Phases 1 to 4: High-Level Plan

Detailed work items are written when each phase starts (Decision 36).

### Phase 1: Identity, access and the IP wall — DONE (pull request open)

**Goal:** Only approved `@jdfusion.in` staff, on approved networks, can use JD Sheets.

**Started 2026-11-06** on branch `phase-1-identity` (from `phase-0-foundation`, whose pull request #1 was still waiting for CI). The owner asked to plan and start at once (2026-11-06), so the plan is written here and built without a separate approval stop. Owner answers: IP ranges are not fixed, so the Network access page is the real wall (Decision 46); the fake mailer is used until the Google account is ready (Decision 47). Technical details: Decision 48. Open, not blocking: Decision 49.

**What you will see:** sign-in; request access with an email code (shown in the server log locally); waiting-for-approval and not-approved screens; forced password change; admin area with Approvals, Users, Network access and Audit trail; being refused from a non-allowed address.

**Execution order:** `W-101 → W-102 → W-103 → W-104 → W-105 → W-106 → W-107 → W-108 → W-109 → W-110 → W-111 → W-112 → W-113 → W-114`.

**Scenario coverage:** every Phase 1 scenario maps to the item named below. Moved: none. `P1-NET-16` (Caddy refuses outside addresses) is tested with the Docker check, using a closed `EDGE_ALLOWED_CIDRS`.

#### W-101: Identity, audit, network and mail tables
- [x] Models of `database_schema.md` 3.6–3.10, 3.12, 3.13, plus `mail_outbox` (Decision 47); email domain check constraint (`P1-DOMAIN-08`); triggers: last active Super Admin (`P1-SA-01`), reserved permissions (`P1-SA-03`), audit append-only (`P1-AUDIT-06`)
- [x] Workbook owner foreign key with the Phase 0 data rule (Decision 48)
- [x] RED integration tests for the constraint and every trigger, then the migration

#### W-102: Email domain rule, passwords and the audit writer
- [x] RED unit tests: `P1-DOMAIN-01..07`, `P1-PWD-01..03`, `X-INPUT-10`; audit events carry no secrets (`P1-AUDIT-02`)
- [x] `src/shared/identity/email.ts` (normalise and check the domain), `identity.passwords.ts` (argon2id, one strength rule), `audit` module writer used inside transactions

#### W-103: Roles in the database (`db:sync-rbac`) and the database principal
- [x] RED tests: sync is idempotent and never removes edited grants (`P1-SEED-03`); reserved codes refused (`P1-SA-03`); a permission removed applies on the next request (`X-ACCESS-07`)
- [x] `syncRbac`, `buildPrincipal(user)`; test principals now come from the database

#### W-104: Sessions, sign-in, sign-out and lockout
- [x] RED tests: `P1-SIGNIN-01..05`, `P1-LOCK-01..06`, `P1-SESS-01..10`, `P1-APPROVE-10`
- [x] Session resolver installed in `instrumentation.ts`; development principal removed (`P1-SESS-11`); same-origin rule for writes with the cookie (`P1-SESS-09`)
- [x] Routes: `POST /api/auth/sign-in`, `POST /api/auth/sign-out`, `GET /api/me`

#### W-105: Forced and voluntary password change
- [x] RED tests: `P1-SIGNIN-06`, `P1-PWD-04`; a must-change user reaches only the change-password screen and its API
- [x] `POST /api/auth/password`

#### W-106: Mailer, OTP sign-up and the pending account
- [x] RED tests: `P1-SIGNUP-01..10`, `P1-OTP-01..11`; `mail.sendOtp` job (`X-JOB-01..03`)
- [x] `Mailer` interface with the `fake` driver (`mail_outbox`; log in development); routes `POST /api/auth/sign-up/request`, `/verify`, `/complete`; test-only `GET /api/test-support/mail`

#### W-107: Approval queue
- [x] RED tests: `P1-APPROVE-01..09`, `P1-APPROVE-11`
- [x] `GET /api/admin/approvals`, `POST /api/admin/approvals/:id/approve`, `/reject`; pending and rejected status screens

#### W-108: User administration and Super Admin protections
- [x] RED tests: `P1-USERS-01..07`, `P1-SA-01..04`, `P1-RESET-01..04`
- [x] Routes for list (filter, search), create, edit, deactivate, reactivate, reset password

#### W-109: Recovery commands
- [x] RED tests: `P1-RESET-05`, `P1-RESET-06`, `P1-NET-14`
- [x] `npm run admin:reset-super-admin -- --email`, `npm run admin:reset-ip-rules -- --cidr`

#### W-110: Network rules and enforcement
- [x] RED tests: `P1-NET-01..15`, `P1-NET-17`, `X-ACCESS-11`
- [x] `network` module: rules service with self-lockout protection, 5-second cache, blocked-request log; enforcement in `route()` and in page rendering; bootstrap rules from `BOOTSTRAP_ALLOWED_CIDRS`

#### W-111: Audit trail screen
- [x] RED tests: `P1-AUDIT-01`, `P1-AUDIT-03..05`, `X-DATA-02`, `X-DATA-03`
- [x] `GET /api/admin/audit` with actor, action and Kolkata date-range filters

#### W-112: Screens
- [x] Sign-in, request access (3 steps), waiting, not approved, change password, blocked page; admin shell (Approvals with count, Users, Network access, Audit trail), user menu with sign-out; `?author=` from the signed-in user (`P1-EDITOR-01`)
- [x] Manual check at 1440 and 390 px

#### W-113: Seeds
- [x] RED tests: `P1-SEED-01`, `P1-SEED-02`
- [x] `seed-test.ts` users per role plus pending, rejected and deactivated; `seed-dev.ts` users; private seed (first Super Admin and bootstrap rules) from env

#### W-114: Journeys and acceptance
- [x] E2E: `P1-E2E-01..04` (journeys 1, 2, 6 and the 403 page) — 8 of 8 journeys pass; `npm run test:e2e` now starts its servers itself (`scripts/e2e-servers.mjs`)
- [x] Full local run once: lint, typecheck, 267 unit, 117 integration, 33 Rust, 24 contract, 8 E2E
- [x] Docs updated (Decisions 46–50, local_setup, database_schema)
- Moved, at the owner's request to save the Mac's resources (2026-11-06): the local fresh-clone drill (CI builds from a fresh clone on every push) and the Docker check with a closed edge allowlist (`P1-NET-16`) move to Phase 4, where the Docker images are built for go-live.

### Phase 2: Workbooks complete and sharing — DONE (pull request open)

**Goal:** People share workbooks with the right role and work safely one editor at a time.

**Branch:** `phase-2-sharing` (from `phase-1-identity`, whose pull request #2 is still open). Owner answers: Decisions 52 (TQ-01 to TQ-05) and 53 (patch 0001 upstream pull request opened by the owner).

**What you will see:** the Share dialog (people, groups, company link, download setting); a Viewer who cannot type; a Commenter who can only comment; "Asha is editing" with Refresh; autosave; version history with named versions and restore; import and export; Shared with me, Recent, search and Trash; admin Groups and Workbooks pages.

**Execution order:** `W-201 → W-202 → W-203 → W-204 → W-205 → W-206 → W-207 → W-208 → W-209 → W-210 → W-211 → W-212 → W-213 → W-214 → W-215`.

**Scenario coverage:** every Phase 2 scenario maps to the item named below. Moved: none. P2-MODE-02 complete with ribbon greying (Decision 55). P2-MODE-01 retired (Decision 55: no patches, no upstream).

**Approved and built 2026-11-06** (owner: "Approve, build it"). Details settled while building: Decision 54.

**How patch 0001 works (investigated at v0.16.1):** every command GridCraft's UI runs goes through the public `SheetApp::run` (`crates/ui-egui/src/app/commands.rs`), and the engine marks each command `undoable`/`journal` or a query. The patch adds an access mode to `SheetApp` (`Edit`, `Comment`, `View`), refuses in `run` any changing command the mode does not allow (comment mode allows only the comment and note commands of `review.*`), keeps the in-cell editor from opening, and greys out the ribbon through the existing "enabled" check. `apps/gridcraft-web/src/host.rs` reads `?mode=` and handles `gridcraft:mode` and `gridcraft:saveNow`. If a change outside `apps/gridcraft-web` and the UI crate's public entry points turns out unavoidable, I stop and ask first (Decision 8). The browser mode is only for comfort: the server is the lock (W-206).

#### W-201: Sharing, groups, lease, recent and trash tables
- [x] Models of `database_schema.md` 3.2 (link role, download setting, trash columns, trigram title index), 3.4, 3.5, 3.11, 3.14; check constraints: a grant names exactly one of user or group, a grant is never `OWNER`, group names unique case-insensitively
- [x] RED integration tests for every constraint, then the migration (expand only)

#### W-202: Groups
- [x] RED tests: `P2-GROUP-01..05` (delete with shares follows Decision 52: `GROUP_IN_USE` without confirmation, then group and shares removed together, audited)
- [x] `identity` groups service; routes under `/api/admin/groups` (`groups:manage`); `groups:manage` added to `db:sync-rbac`

#### W-203: The `sharing` module and the role resolver
- [x] RED tests: `P2-SHARE-01..08`, `P2-SHARE-11`, `P2-SHARE-12`, `P2-LINK-01`, `P2-LINK-02`, `P2-LINK-04`, `P2-ROLE-01` (a matrix test calling every workbook route as each role and as a stranger)
- [x] Grants for users and groups, the company link, the download setting; the resolver (owner, direct, group, link: highest wins; deactivated members get nothing) replaces the Phase 0 resolver; link visits recorded; every change audited
- [x] Routes: `GET/PUT/DELETE /api/workbooks/:id/shares…`, `PUT /api/workbooks/:id/link`, `GET /api/share-targets?q=` (active users and groups only)

#### W-204: Lists, search and Recent
- [x] RED tests: `P2-SHARE-09`, `P2-SHARE-10`, `P2-LINK-03` (Decision 52), `P2-LIST-01..03`
- [x] `GET /api/workbooks?scope=mine|shared|recent&q=&sort=` with keyset paging; recent opens recorded on open (newest 50 kept, 20 shown)

#### W-205: GridCraft patch 0001 (access mode and save now)
- [x] RED tests (Rust, headless `SheetApp` against the patched copy, the way GridCraft's own control tests run): `P2-MODE-02`, `P2-MODE-04`, `P2-MODE-06`, `P2-MODE-07`; patch check `P2-MODE-01` (applies to the pinned tag; header names the upstream pull request or `pending` with its text file, Decision 53)
- [x] `patches/gridcraft/0001-access-mode.patch`, `0001-access-mode.upstream.md` (pull request text for the owner); bridge: `?mode=`, `gridcraft:mode`, `gridcraft:saveNow`, with `contracts/bridge/messages.json` examples and bridge unit tests (`P2-MODE-05`)

#### W-206: Role-aware saving (the server lock)
- [x] RED tests: `P2-ROLE-02..05`, `P2-MODE-03`; Rust tests for `diff-kind` (cells, formats, sheets, names, comments; another person's comment changed or deleted)
- [x] Rust `POST /internal/workbooks/diff-kind` (base and new bytes, the Commenter's name → `NONE`, `COMMENTS_ONLY`, `OTHER`, `FOREIGN_COMMENT`); the save route refuses Viewers, sends Commenters' saves through the check, needs the lease for Editors and Owners (W-207)

#### W-207: Edit lease
- [x] RED tests: `P2-LEASE-01..10` (concurrency test for `P2-LEASE-06`; clock advanced for 89 and 91 seconds; second tab and "Move editing here" per Decision 52)
- [x] `POST /api/workbooks/:id/lease` (take, renew, take over own), `DELETE` (release, also with `sendBeacon` on close); save without the lease → `WORKBOOK_LOCKED`; renewal re-checks the role

#### W-208: Editor page: modes, banner, autosave, leaving safely
- [x] RED tests (unit-dom and bridge): `P2-MODE-08`, `P2-SAVE-01..04` (timings from the single source of truth, Decision 52)
- [x] Editor opens in the role's mode; banner "Asha is editing" with Refresh, or "You are editing this in another tab" with "Move editing here"; mode switches live on role or lease change; autosave through `gridcraft:saveNow`; friendly retry on failure; unsaved-changes prompt

#### W-209: Version history, named versions and restore
- [x] RED tests: `P2-VER-01..05`, `P2-ROLE-07`, `P2-ROLE-08`
- [x] Routes: list versions, name a version, read an old version's content, restore (new version, audited; refused while someone else holds the lease); rename a workbook (Owner, Editor)

#### W-210: Import, export and the download setting
- [x] RED tests: `P2-IMPORT-01..05`, `P2-EXPORT-01..03`, `P2-ROLE-06`; Rust tests for conversion with golden files
- [x] Rust `POST /internal/workbooks/convert` (`.xlsx`, `.xlsb`, `.ods`, `.csv`, `.tsv` → `.xlsx`, through GridCraft's readers); `POST /api/workbooks/import`; download honours the setting; PDF export arrives as `gridcraft:save` with a `.pdf` name and is downloaded by the page

#### W-211: Trash and owner actions
- [x] RED tests: `P2-TRASH-01`, `P2-TRASH-02`, `P2-TRASH-04`, `P2-ROLE-09`
- [x] Move to Trash, restore within 30 days with shares intact, delete forever (Owner only); trashed workbooks are `NOT_FOUND` for everyone else

#### W-212: Administrator workbook tools
- [x] RED tests: `P2-ADMINWB-01..05` (old owner kept as Editor, Decision 52)
- [x] `GET /api/admin/workbooks` (metadata only, deactivated owners filterable), transfer ownership, "open as administrator" with a reason (view mode, audited every time)

#### W-213: Jobs: version pruning and trash purge
- [x] RED tests: `P2-VER-06`, `P2-VER-07`, `P2-TRASH-03` (clock advanced; run twice = one effect, X-JOB-*)
- [x] `workbooks.pruneVersions` (nightly, run date), `workbooks.purgeTrash` (nightly, workbook id): rows and files together; never a named or current version

#### W-214: Screens
- [x] Share dialog; home tabs My workbooks, Shared with me, Recent, Trash with search and sort; Import; version history panel; admin Groups and Workbooks pages; editor banners
- [x] Manual check at 1440 and 390 px

#### W-215: Seeds, journeys and acceptance
- [x] Seeds: shared workbooks, a group and a company link in `seed-test.ts` and `seed-dev.ts`
- [x] E2E: `P2-E2E-01` (journey 4), `P2-E2E-02` (journey 5), `P2-E2E-03` (lease handover)
- [x] Full local run once (lint, typecheck, unit, integration, Rust, contract, E2E); docs updated (`project_data.md`, `database_schema.md`, `local_setup.md`, decision log)
- [x] Editor and Rust builds run only in W-205, W-206 and W-210 and at the final run (Decision 51)

### Phase 3: Live collaboration — DONE (pull request open)

**Goal:** Several people (15–20) edit the same workbook at the same time, like Google Sheets, and always end with the same content.

**Branch:** `phase-3-collab` (from `phase-2-sharing`). Owner answers: Decision 56 (undo, same-cell edits, 25 editors at most, versions every 10 minutes) and Decision 57 (Super Admins from any network).

**What you will see:** two or more browsers on one workbook, each seeing the others' typing and selected cells live, with names and colours; a Commenter's comment appearing live; a person switched to Viewer dropping to view mode at once; "Live editing" versions in History; a Super Admin signing in from home.

**Execution order:** `W-301 → W-302 → W-303 → W-304 → W-305 → W-306 → W-307 → W-308 → W-309 → W-310 → W-311`.

**Scenario coverage:** every Phase 3 scenario maps to the item named below. Retired: P3-PATCH-01 (Decision 55). New: P3-NETSA-01..04 for Decision 57. Partly met: P3-ROLE-01's "audited as attempts" (logged, not in the audit trail; Decision 58). P2-E2E-03 (lease handover in the browser) is now covered by the lease integration tests, since the browser journeys run live.

**Approved and built 2026-11-06** (owner: "Approve, build it"). Details settled while building: Decision 58.

**How live editing works (built on Decision 22):** GridCraft's macro recorder already records every command with the sheet and selection it ran on, which is what replay needs. Our GridCraft sends each such step to the page (`gridcraft:command`). The page sends it over a WebSocket to the Rust service, which checks the role, runs it on its own copy of the workbook, numbers it, stores it in `collab_ops` and sends it to everyone (`gridcraft:apply`). Undo stays per person (Decision 56). Paste normally reads the person's own clipboard; our GridCraft puts the copied cells into the paste step instead, so everyone gets the same result. **Risk first:** W-302 proves that replay gives identical workbooks on a large set of commands before anything else is built on it. If a command can't be replayed exactly, it is sent as the cells it changed instead.

#### W-301: Super Admins from any network (Decision 57)
- [x] RED tests: P3-NETSA-01 (a Super Admin signs in and works from outside; audited, shown on the Network page), -02 (anyone else signing in from outside gets the blocked page and no session), -03 (pages and the API from outside need a Super Admin session), -04 (sign-in limits and lockout still apply); Phase 1 network tests updated
- [x] Network check moves after the session for signed-in requests; `network.outsideAccess` audit; Network page lists recent outside access

#### W-302: Live commands in our GridCraft (replaces "patch 0002")
- [x] Spike, RED tests first (Rust, native): a corpus of about 60 commands (typing, formulas, fill, sort, insert and delete rows, columns and sheets, formats, merges, comments, paste after copy and cut), each run on one session and replayed as recorded steps on another. Identical workbooks for every one, or the command is marked "send as changed cells"
- [x] `gridcraft:command { clientCommandId, baseSeq, step }` for every top-level step; view-only commands (scroll, selection) never sent (P3-PATCH-02, -05)
- [x] `gridcraft:apply` runs others' steps without echo and outside the person's own undo (P3-PATCH-03, -04, Decision 56); `gridcraft:resync { bytes, seq }` keeps scroll and selection where possible (P3-PATCH-06)
- [x] Paste carries its copied cells; bridge contract and unit tests for the new messages

#### W-303: `collab_ops`, the collab token route and the snapshot route
- [x] Table of database_schema.md 3.15 (Prisma); RED tests for uniqueness of (`workbookId`, `seq`) and (`workbookId`, `userId`, `clientCommandId`)
- [x] `POST /api/workbooks/:id/collab-token` (read): token with role and display name (Decision 10)
- [x] `POST /api/internal/collab/snapshots` (internal): stores a snapshot as a version (`LIVE_SNAPSHOT`, contributors), never on top of a newer version (P3-SNAP-01..03 app side)

#### W-304: The WebSocket in the Rust service
- [x] RED tests (real WebSocket clients): P3-WS-01, -02, -03, -06, -07, -08
- [x] `/collab/:workbookId` upgrade, token check at connect and on refresh, message size and rate limits, reconnect from a sequence number

#### W-305: One live session per workbook: ordering, roles and rebasing
- [x] RED tests: P3-ORDER-01..03, P3-ROLE-01..05, P3-REBASE-01..06, P3-PERF-02, -03 (25 editors, Decision 56)
- [x] Session manager (load the current version, run steps, number them, store them in `collab_ops`, send them to everyone); rebasing rules of Decision 56 (the later change wins; rows, columns and sheets shift pending edits; deleted sheet → refuse and resync)
- [x] Access changes pushed from the app close or downgrade connections within seconds (P3-WS-04, -05)

#### W-306: Convergence property tests
- [x] P3-CONV-01 (2–8 simulated clients, random commands, delays and reconnects → identical values everywhere), -02 (replaying `collab_ops` gives the live workbook), -03 (golden workbooks keep their checked cells)

#### W-307: Presence
- [x] RED tests: P3-PRES-01..05 (names and colours from the token; one entry per person; gone within 30 seconds)

#### W-308: Snapshots, recovery, restore and fallback
- [x] RED tests: P3-SNAP-01..03 (every 10 minutes of editing and when the last person leaves, "Live editing" with contributors, retries without loss), P3-RECOV-01..03, P3-RESTORE-01, P3-FALLBACK-02
- [x] Restart recovery from the last version plus later commands; pruning of old `collab_ops`

#### W-309: The editor page goes live
- [x] RED tests (unit-dom and bridge): live connection, reconnect, presence list and colours, mode drop on role change, P3-FALLBACK-01 (service unreachable → the Phase 2 edit lease with a friendly notice)
- [x] Presence avatars in the top bar; others' selections shown in the grid (our GridCraft draws them from presence)

#### W-310: Performance check
- [x] P3-PERF-01: 20 simulated editors on the office-network profile, 95th percentile under 300 ms (Rust test with timings recorded in `hardening_results.md`)

#### W-311: Journey, full run and docs
- [x] E2E: P3-E2E-01 (journey 7: two browsers edit live and end with the same values; a third as Viewer sees it live)
- [x] Full local run once (lint, typecheck, unit, integration, contract, Rust, editor tests, E2E); docs updated (project_data 4.6 bridge table, database_schema, local_setup, decision log)

### Phase 4: Hardening and go-live — PENDING

**Goal:** JD Sheets runs reliably for the whole company on the Hostinger VPS.

**Scope:** load test (concurrent editors per workbook, open workbooks per service, save sizes), memory limits for the Rust service; security review (headers, CSP, cookies, rate limits, dependency audit, `cargo audit`); monitoring and alerts; structured logs; backups with a restore drill; VPS setup (firewall, SSH keys, Docker, Caddy on the real domain); deployment pipeline with automatic migrations; `runbook.md` and `hardening_results.md` completed; owner acceptance.

**Owner answers (Decision 59):**
- **Domain:** `sheets.jdfusion.in`, DNS at GoDaddy.
- **Server:** the existing Hostinger KVM 2, shared with n8n and probably the CRM.
- **Backups:** Google Drive, plus a local copy on the VPS.
- **Alerts:** email to the owner.
- **Load test:** 30 staff, 20 editing one workbook at once, largest workbook about 10,000 rows.

**Still pending from the owner:** GoDaddy access (DNS record), the office and VPN IPs, the Google account and app password for sign-up emails. **Next step:** plan Phase 4 in a new session, starting by inspecting the server (what already uses ports 80 and 443, and memory).

**What you will see:** JD Sheets live on its domain, reachable only from the office networks.
