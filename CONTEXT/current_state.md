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
| 0 | Foundation and walking skeleton | GridCraft running locally on day one; by the end, our app: file list, new workbook, edit, save, reopen | **IN PROGRESS** (W-001 to W-014 done 2026-11-06; W-015 to W-017 being verified; pull request #1) |
| 1 | Identity, access and the IP wall | Sign-in, sign-up with OTP, approval queue, admin user screens, network rules, blocked page, audit trail | PENDING |
| 2 | Workbooks complete and sharing | Share dialog with four roles, view and comment modes, edit lease, version history and restore, autosave, import/export, trash, groups | PENDING |
| 3 | Live collaboration | Two people editing the same workbook at once, presence and selections, live comments | PENDING |
| 4 | Hardening and go-live | Load-tested, backed up, deployed on the Hostinger VPS behind the real domain | PENDING |

---

# Phase 0: Foundation and Walking Skeleton — IN PROGRESS

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

- [ ] Dockerfiles: app and worker (Node standalone), collab (Rust multi-stage, also builds the editor in a stage with trunk), Caddy with the built editor files
- [ ] `docker/Caddyfile`: `/editor/*` static, `/api/internal/*` refused from outside, `/collab/*` to the service (Phase 3), the rest to the app; `EDGE_ALLOWED_CIDRS` matcher (off locally by default)
- [ ] `docker-compose.local.yml` profile `full` on `127.0.0.1:47324`; `docker-compose.prod.yml`
- [ ] RED checks: runtime images contain no compiler and run as non-root (`P0-DOCKER-02`); the full stack passes a smoke test: health of app, worker and collab, create-and-save through Caddy (`P0-DOCKER-01`)

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

- [ ] Fresh clone in a new folder, following only `local_setup.md`: env files, Docker, `setup:rust`, `editor:build`, migrations, seeds, `ci:quality`, `rust:ci`, `test:e2e`; all green (`P0-DRILL-01`)
- [ ] Every difference between the docs and reality fixed in `local_setup.md` in the same change
- [ ] The owner walks through create → edit → save → reload on `127.0.0.1:47320`
- [ ] Findings logged as a decision; Phase 0 marked DONE

---

# Phases 1 to 4: High-Level Plan

Detailed work items are written when each phase starts (Decision 36).

### Phase 1: Identity, access and the IP wall — PENDING

**Goal:** Only approved `@jdfusion.in` staff, on approved networks, can use JD Sheets.

**Scope:** users and statuses; admin-created accounts; self sign-up with email OTP (Google SMTP through the `mail.sendOtp` job; `fake` in tests); approval queue; sign-in, sessions, lockout, sign-out; forced password change; admin password reset and the Super Admin recovery command; user management screens; the session principal resolver (development principal removed); the `network` module with IP rules, client-IP parsing, self-lockout protection, the recovery command, the blocked page and the edge allowlist in Caddy; audit trail table, writer and screen; "Signed in as" in the editor (`?author=`).

**Needs from the owner at the start:** office and VPN IP ranges (Q-03); the Google sending account and app password (Q-04), only for the manual check; development and tests use `fake`.

**What you will see:** the sign-in and sign-up screens, the OTP email (in the fake mailbox locally), the approval queue, user screens, the network rules page, being blocked from a non-allowed IP, the audit trail.

**Critical journeys:** 1, 2, 6.

### Phase 2: Workbooks complete and sharing — PENDING

**Goal:** People share workbooks with the right role and work safely one editor at a time.

**Scope:** the `sharing` module (grants to users, groups, the company link, the resolver replacing the Phase 0 one); groups; Share dialog; "Shared with me", Recent, search, Trash; GridCraft **patch 0001 (access mode)** with its upstream pull request; view and comment modes; the Commenter save check (`diff-kind` in the Rust service); edit lease with banner and refresh; autosave; version history, named versions, restore; import (`.xlsx`, `.xlsb`, `.ods`, `.csv`) and export; download setting for Viewers and Commenters; administrator workbook list, ownership transfer, audited "open as administrator"; version pruning and trash purge jobs.

**What you will see:** sharing a workbook, a Viewer who cannot type, a Commenter who can only comment, "Asha is editing", restoring an older version, Trash.

**Critical journeys:** 4, 5.

### Phase 3: Live collaboration — PENDING

**Goal:** Several people edit the same workbook at the same time and always end with the same content.

**Scope:** GridCraft **patch 0002 (command messages)** with its upstream pull request; the WebSocket in the Rust service; one engine session per open workbook; ordered command log (`collab_ops`); rebasing and resync rules; role checks per command (comment-only for Commenters, none for Viewers); token refresh and access-changed push; presence (who, colour, selected cell); snapshots to versions; restart recovery; fallback to the edit lease when the service is down.

**What you will see:** two browsers on one workbook, each seeing the other's typing and selection; a Commenter's comment appearing live; a person switched to Viewer dropping to view mode at once.

**Critical journey:** 7.

### Phase 4: Hardening and go-live — PENDING

**Goal:** JD Sheets runs reliably for the whole company on the Hostinger VPS.

**Scope:** load test (concurrent editors per workbook, open workbooks per service, save sizes), memory limits for the Rust service; security review (headers, CSP, cookies, rate limits, dependency audit, `cargo audit`); monitoring and alerts; structured logs; backups with a restore drill; VPS setup (firewall, SSH keys, Docker, Caddy on the real domain); deployment pipeline with automatic migrations; `runbook.md` and `hardening_results.md` completed; owner acceptance.

**Needs from the owner:** domain and DNS (Q-05), backup target (Q-06), VPS plan (Q-07).

**What you will see:** JD Sheets live on its domain, reachable only from the office networks.
