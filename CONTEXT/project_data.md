# Project Data: JD Sheets

The reference for business rules, architecture, roles and permissions, environments and shared values. Decisions referenced as "Decision N" are in `decision_log.md`. If this file and the decision log disagree, the newest decision wins and this file is fixed in the same change.

---

## 1. Core Metadata

| Item | Value |
|:---|:---|
| Product | JD Sheets |
| Company | JD Fusion (single company, Decision 2) |
| Allowed email domain | `jdfusion.in`, everywhere (Decision 12) |
| Users | JD Fusion staff only, on approved networks |
| Business timezone | `Asia/Kolkata` |
| Spreadsheet engine and UI | GridCraft (open source, Rust, MIT or Apache-2.0), our own copy at `vendor/gridcraft`, based on v0.16.1 and edited directly (Decisions 6, 55) |
| App stack | Next.js 16, TypeScript strict, Prisma 7, PostgreSQL 17, pg-boss, Zod, Luxon |
| Engine and collaboration service | Rust (edition 2024), axum, tokio, sqlx, `gridcraft-engine` |
| Hosting | Hostinger VPS, Docker Compose, Caddy (Decision 37) |
| Local ports | app 47320, collab 47321, Postgres 47322, full-stack Caddy 47324, GridCraft preview 47325; tests: app 47330, collab 47331 |

---

## 2. Product Summary

JD Sheets is JD Fusion's own spreadsheet in the browser.

- **Where:** only from approved networks (IP allowlist at the edge and in the app).
- **Who:** only `@jdfusion.in` staff. Accounts are made by an admin, or requested through sign-up with an email OTP and then approved by an admin.
- **What:** a full spreadsheet (GridCraft): formulas, formatting, tables, charts, pivot tables, threaded comments, XLSX import and export.
- **Around it:** a home screen with My workbooks, Shared with me, Recent and Trash; sharing with Owner, Editor, Commenter and Viewer roles; version history with restore; an admin area for users, approvals, groups, network rules and the audit trail.
- **Together:** first one editor at a time with a visible lease (Phase 2), then live co-editing with presence (Phase 3).

---

## 3. Business Rules

### 3.1 Accounts (Decisions 12, 14, 15)

| Rule | Detail |
|:---|:---|
| Email domain | Exactly `jdfusion.in` after the last `@`, lower-cased and trimmed. No subdomains, no look-alikes. Enforced in the service and by a database check constraint. |
| Ways to get an account | Admin creates it (active at once, must change password at first sign-in), or self sign-up (OTP, then pending approval) |
| Statuses | `PENDING_APPROVAL` → `ACTIVE` or `REJECTED`; `ACTIVE` ↔ `DEACTIVATED`; `REJECTED` → `PENDING_APPROVAL` again by signing up again |
| Who can sign in | Only `ACTIVE` users get a working session. `PENDING_APPROVAL` and `REJECTED` users who enter the right password see a status screen and nothing else. |
| OTP | Sign-up only. 6 digits, 10 minutes, single use, hashed, 5 wrong tries, 60 s between resends, 5 per email per hour, 20 per IP per hour. |
| Password | 12–128 characters, not the email, not only spaces |
| Forgot password | Admin reset only. Temporary password, must change at next sign-in, all sessions signed out. |
| Super Admin recovery | `npm run admin:reset-super-admin` on the server |
| Lockout | 5 wrong passwords → 15-minute lock; 20 sign-in attempts per IP per 15 minutes |
| Sessions | 12 h idle, 7 days absolute |
| Last Super Admin | Cannot be deactivated or demoted |

### 3.2 Network Access (Decision 18)

| Rule | Detail |
|:---|:---|
| Edge allowlist | `EDGE_ALLOWED_CIDRS` in Caddy. Outside it: a static blocked page, 403. |
| App allowlist | `network_ip_rules` (CIDR, label, enabled). Checked on every page, API call and token issue. |
| Client IP | From `X-Forwarded-For`, trusting exactly `TRUSTED_PROXY_HOPS` proxies. IPv6 supported, IPv4-mapped IPv6 normalised. |
| Self-lockout | A rule change that excludes the editor's own current IP is refused. The rule set can never be empty while enforcement is on. |
| Recovery | `npm run admin:reset-ip-rules -- --cidr <cidr>` on the server |
| Collab connections | The token carries the IP; the Rust service refuses a different IP. |

### 3.3 Workbooks (Decisions 17, 20, 21)

| Rule | Detail |
|:---|:---|
| Format | `.xlsx` stored; GridCraft also imports `.xlsb`, `.ods`, `.csv`, `.tsv`, which are converted to `.xlsx` on import |
| Size limit | 50 MiB (`WORKBOOK_MAX_BYTES`) |
| Validation | File signature + a real open through the GridCraft engine in the Rust service |
| Saving | Whole file as a new version; refused with `CONFLICT` if based on an old version |
| Version retention | All for 30 days; then one per day up to 1 year; then one per month. Named versions forever. |
| Trash | 30 days, then purged with its files |
| Titles | 1–200 characters, trimmed; duplicates allowed |
| Editing (Phase 2) | One editor at a time through a 90-second lease renewed every 30 seconds |
| Editing (Phase 3) | Live co-editing through the Rust service |

### 3.4 Sharing (Decision 17)

- One Owner per workbook. Grants of `EDITOR`, `COMMENTER`, `VIEWER` to users or groups. Optional company link with a chosen role.
- Effective role = highest of owner, direct grant, group grants, company link.
- No role → `NOT_FOUND` and invisible in every list, count and search.
- Only the Owner shares, changes roles, sets the company link, transfers ownership and deletes.
- Owner can turn off download and export for Viewers and Commenters (default: allowed). Note: a determined person can still copy what they can see.
- Super Admin (or `workbooks:administer`) sees all workbooks' metadata, transfers ownership and deletes; opening content without a role needs an audited "open as administrator" with a reason.

---

## 4. Technical Architecture

### 4.1 The Whole System

```
                      Approved office / VPN networks only
                                     │ HTTPS
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ CADDY (edge)  TLS · EDGE_ALLOWED_CIDRS · compression · reverse proxy    │
└───────────────┬───────────────────────────────┬──────────────────────────┘
                │ /, /api/*                     │ /collab/* (WebSocket, Phase 3)
                ▼                               ▼
┌───────────────────────────────────┐   ┌──────────────────────────────────┐
│ NEXT.JS APP (modular monolith)    │   │ RUST COLLAB SERVICE (axum/tokio) │
│  proxy.ts: IP rules, nonce, CSP   │   │  token verify (JWT, IP claim)    │
│  route(): access guard,           │   │  engine/: the ONLY gridcraft-    │
│   workbook-role resolver, errors  │   │   engine user                    │
│  modules: identity, network,      │◄──┤  /internal/workbooks/validate    │
│   workbooks, sharing, editor,     │   │  (Phase 3) Session per workbook, │
│   audit, system                   │──►│   ordered ops, presence,         │
│  pages: home, /w/:id editor host, │   │   snapshots → app internal API   │
│   admin                           │   └───────────────┬──────────────────┘
└───────┬───────────────┬───────────┘                   │ sqlx (collab_ops)
        │ Prisma        │ FileStorage                   │
        ▼               ▼                               ▼
┌──────────────┐  ┌───────────────────┐        ┌──────────────┐
│ PostgreSQL   │  │ Workbook files    │        │ (same        │
│ (+ pg-boss)  │  │ local volume / S3 │        │  Postgres)   │
└──────▲───────┘  └───────────────────┘        └──────────────┘
       │
┌──────┴──────────────┐
│ WORKER (pg-boss)    │  mail.sendOtp, cleanups, version pruning, trash purge
└─────────────────────┘

BROWSER
┌─────────────────────────────────────────────────────────────┐
│ Next.js page /w/:id  (top bar: title, save state, people,   │
│                       Share, Versions)                      │
│  bridge.ts ──postMessage──► <iframe src="/editor/?host=parent│
│     ▲  open / save / dirty     &author=…&mode=…">            │
│     │  (Phase 2) mode          GridCraft WASM (canvas)       │
│     │  (Phase 3) command/apply                               │
│     └── fetch /api/... and (Phase 3) WebSocket /collab/...   │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Request Path (Next.js)

```
Frontend (React) ↔ route.ts ↔ Controller ↔ Service ↔ Repository ↔ Database
```

| Layer | Lives in | Does | Must not |
|:---|:---|:---|:---|
| Frontend | `src/app/**/page.tsx`, `src/modules/<m>/ui/` | Screens; talks to the backend only through `src/shared/api/client.ts` | Import server code |
| Route | `src/app/api/**/route.ts` | `export const POST = route({ access, handler })` | Hold logic |
| Controller | `<m>.controller.ts` | Access declaration, Zod parsing, calls the service, shapes the response | Touch Prisma |
| Service | `<m>.service.ts` | Business rules, workbook-role checks, transactions, events | Import `next/*` |
| Repository | `<m>.repository.ts` | Prisma queries; writes only its own tables | Hold business rules |

### 4.3 Repository Layout

```
jd-sheets/
├── CONTEXT/                     # this documentation
├── vendor/gridcraft/            # our own GridCraft (based on v0.16.1), edited directly (Decision 55)
├── contracts/                   # shared fixtures read by TS and Rust tests (collab token, bridge messages)
├── golden/                      # golden workbooks for upgrade tests (no real company data)
├── services/collab/             # Rust service (own Cargo workspace)
│   ├── Cargo.toml  rust-toolchain.toml
│   └── src/ main.rs lib.rs config.rs error.rs clock.rs token.rs ip.rs http.rs
│            engine/ (the only gridcraft-engine user)   ws/, ops/, store/ (Phase 3)
├── scripts/
│   ├── editor-build.mjs         # copy vendor/gridcraft → .build/gridcraft, trunk build → public/editor
│   └── ...
├── prisma/  schema.prisma  migrations/  seed-test.ts  seed-dev.ts  private/ (git-ignored)
├── src/
│   ├── app/                     # pages and api routes (composition root)
│   ├── modules/<module>/        # controller, service, repository, schemas, types, jobs, ui, __tests__, index.ts
│   ├── shared/                  # config, rbac, errors, time, db, http, api, storage, mail, jobs, net, logger, ui
│   ├── worker/                  # worker entry
│   ├── proxy.ts                 # IP rules, nonce, CSP
│   └── tests/                   # architecture, SSOT, security scans
├── e2e/                         # Playwright journeys
├── docker/                      # compose files, Caddyfile, Postgres init
└── public/editor/               # BUILD OUTPUT of the editor (git-ignored)
```

### 4.4 Modules

| Module | Owns | Phase |
|:---|:---|:---|
| `system` | Health, diagnostics, version info (app, editor, the GridCraft release our copy is based on) | 0 |
| `workbooks` | Workbooks, versions, storage keys, validation calls, trash, edit leases, the file list | 0 (core), 2 (rest) |
| `editor` | The editor host page, the bridge protocol, editor modes | 0 (bridge), 2 (modes), 3 (commands) |
| `identity` | Users, sign-up, OTPs, approval, sessions, passwords, groups, roles | 1 (groups in 2) |
| `network` | IP rules, client-IP parsing, blocked-request log | 1 |
| `sharing` | Grants, company link, effective-role resolution | 2 |
| `audit` | Append-only audit trail and its screen | 1 |
| `collab` | Collab tokens, internal snapshot route, access-changed push | 3 (token contract in 0) |

**Boundary rules** (`npm run lint:arch`, as Explore Hills): import another module only through its `index.ts`; only `src/app/**` imports controllers; only repositories, seeds, scripts and `shared/db` import Prisma; `src/shared/**` never imports modules; UI never imports server code; no cycles; only `shared/storage/registry.ts` imports a storage driver, only `shared/mail/registry.ts` imports a mail driver, only `shared/jobs/` imports pg-boss; only `src/modules/editor/bridge/` knows GridCraft's message names.

**Rust boundary rules** (checked by a test that scans `services/collab/src`): only `src/engine/` names `gridcraft_*` crates; handlers never touch sqlx directly (they go through `src/store/`); time only through `Clock`.

### 4.5 API Conventions

- Success `{ data }`; failure `{ error: { code, message, fieldErrors?, requestId } }`, one `ApiResponse<T>` type everywhere.
- Instants as ISO-8601 UTC strings ending in `Z`.
- IDs: UUID v7.
- Workbook content: `GET /api/workbooks/:id/content` streams `.xlsx` bytes with `ETag: <versionId>`; `PUT /api/workbooks/:id/content` with header `If-Match: <baseVersionId>` saves (`409 CONFLICT` if it moved on).
- Internal routes (`access: 'internal'`) require `INTERNAL_SERVICE_TOKEN` and are reachable only on the Docker network; Caddy refuses `/api/internal/*` from outside.

### 4.6 The Editor Bridge Protocol

| Message | Direction | When | Phase |
|:---|:---|:---|:---|
| `gridcraft:ready` | editor → page | Editor is listening | 0 |
| `gridcraft:open { name, bytes }` | page → editor | After `ready`, with the current version's bytes | 0 |
| `gridcraft:save { name, bytes }` | editor → page | User saved (Ctrl/Cmd+S, File › Save); page `PUT`s `.xlsx` with `If-Match`; other files (PDF export) are downloaded | 0 |
| `gridcraft:dirty { dirty }` | editor → page | Unsaved state changed; page shows it | 0 |
| URL `?host=parent&chrome=notitlebar&author=…` | page → editor | On load: host mode, GridCraft's title bar hidden, comment author (Decision 43) | 0 |
| `gridcraft:saveNow` | page → editor | Ask the editor to save, for autosave (access mode, Decisions 43, 54); ignored in view mode | 2 |
| `gridcraft:failed { error }` | editor → page | Editor could not start; page shows a friendly message | 0 |
| URL `?mode=view\|comment\|edit` | page → editor | On load (access mode; also greys out the ribbon, Decision 55) | 2 |
| `gridcraft:mode { mode }` | page → editor | Role or lease changed while open (access mode); changes the mode does not allow are put back after each frame (Decision 54) | 2 |
| `gridcraft:command { seq, id, params }` | editor → page | Every engine command run locally (Phase 3 GridCraft change) | 3 |
| `gridcraft:apply { seq, id, params }` | page → editor | A command from another person (Phase 3 GridCraft change) | 3 |
| `gridcraft:resync { bytes, seq }` | page → editor | Reload after a rejected command (Phase 3 GridCraft change) | 3 |

The bridge validates every message (origin, shape, size) and ignores anything else.

### 4.7 Background Jobs

`defineJob()` per module, run by the worker, idempotent, tested with `runPendingJobs()` and the clock advanced (Decision 31).

| Job | Trigger | Idempotency key |
|:---|:---|:---|
| `mail.sendOtp` | OTP requested | OTP ID |
| `identity.cleanupExpired` | Every hour | run hour |
| `workbooks.pruneVersions` | Nightly | run date |
| `workbooks.purgeTrash` | Nightly | workbook ID |
| `workbooks.purgeOrphanFiles` | Weekly | storage key |

---

## 5. Access Control

### 5.1 Concepts

- **Permission:** one yes/no right, `resource:action`, in `src/shared/rbac/permissionRegistry.ts`.
- **Role:** a bundle of permissions in the database. System roles only (Decision 16).
- **Principal:** user, role, permissions and session, rebuilt on every request.
- **Guard:** in front of every route, deny by default; `SUPER_ADMIN` bypasses the global permission check through the guard only.
- **Workbook role:** separate from the global role; resolved per workbook by the `sharing` module (Decision 17).

### 5.2 Rules

1. Every `route()` declares `access`: `{ permission }`, `{ anyOf }`, `'authenticated'`, `'public'` (allow-listed) or `'internal'`.
2. Workbook routes declare `'authenticated'` plus a workbook capability (`workbook: 'read' | 'comment' | 'edit' | 'share' | 'own'`); the route wrapper resolves the effective role and returns `NOT_FOUND` when there is none.
3. Feature code never checks role names; only the guard and the resolvers read the bypass flag.
4. A permission removed from a role, a share removed or a user deactivated takes effect on the next request.

### 5.3 System Roles

| Role | Purpose |
|:---|:---|
| `SUPER_ADMIN` | Owner of the system. Bypasses global permission checks. Manages admins. |
| `ADMIN` | Manages users, approvals, groups and network rules; sees the audit trail |
| `MEMBER` | Uses JD Sheets: creates workbooks, works on what is shared with them |

### 5.4 Permission Catalogue

| Code | What it allows | SUPER_ADMIN | ADMIN | MEMBER |
|:---|:---|:---:|:---:|:---:|
| `workbooks:create` | Create and import workbooks | ✓ (bypass) | ✓ | ✓ |
| `workbooks:administer` | See all workbooks' metadata, transfer ownership, delete, open as administrator (audited) | ✓ (bypass) | – | – |
| `users:view` | See the user list | ✓ | ✓ | – |
| `users:create` | Create accounts | ✓ | ✓ | – |
| `users:edit` | Change name, role (not to or from Super Admin) | ✓ | ✓ | – |
| `users:deactivate` | Deactivate and reactivate | ✓ | ✓ | – |
| `users:approve` | Approve or reject sign-ups | ✓ | ✓ | – |
| `users:reset-password` | Set a temporary password (not for Super Admins) | ✓ | ✓ | – |
| `groups:manage` | Create groups and manage members (Phase 2) | ✓ | ✓ | – |
| `network:view` | See IP rules and blocked requests | ✓ | ✓ | – |
| `network:manage` | Change IP rules | ✓ (bypass) | – | – |
| `audit:view` | See the audit trail | ✓ | ✓ | – |
| `system:diagnostics` | See the diagnostics page | ✓ (bypass) | – | – |
| `users:manage-super-admins` | **Reserved.** Create, edit, reset or demote Super Admins | bypass only | – | – |
| `roles:manage` | **Reserved.** Change role bundles | bypass only | – | – |

### 5.5 Workbook Capabilities by Role

| Capability | Owner | Editor | Commenter | Viewer |
|:---|:---:|:---:|:---:|:---:|
| `read` (open, read content, export unless disabled) | ✓ | ✓ | ✓ | ✓ |
| `comment` (comment commands; Phase 3 enforced per command) | ✓ | ✓ | ✓ | – |
| `edit` (save content, rename, restore version, take the edit lease) | ✓ | ✓ | – | – |
| `history` (see versions) | ✓ | ✓ | ✓ | – |
| `share` (grants, company link, export setting) | ✓ | – | – | – |
| `own` (transfer, trash, delete) | ✓ | – | – | – |

Phase 2 note: before Phase 3, a Commenter's comment is saved by saving the whole workbook. The server accepts a Commenter's save only if the only differences from the base version are comments; this check is done by the Rust engine (`POST /internal/workbooks/diff-kind`). Planned in Phase 2.

---

## 6. Time and Dates

- Instants `timestamptz` UTC; business dates `date`; timezone `Asia/Kolkata`.
- Only `src/shared/time/` (TS) and the `Clock` trait (Rust) read the clock.
- Shown to users in `Asia/Kolkata` with formats from the single source of truth ("6 Nov 2026, 3:42 pm").
- Values inside workbooks are never touched by our time code.

---

## 7. Single Source of Truth

`src/shared/config/appConfig.ts` holds: product and company names, `allowedEmailDomain`, support contact text, timezone and date formats, OTP rules, session lengths, lockout numbers, `workbookMaxBytes`, version retention and trash periods, edit lease timings, collab token lifetime, snapshot thresholds, port defaults. Rust reads its copies from env with defaults checked equal by a test. The SSOT scan test fails on these literals anywhere else.

---

## 8. Error Handling

- One catalog (`src/shared/errors/errorCatalog.ts`): `VALIDATION_FAILED`, `REQUEST_TOO_LARGE`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INVALID_CREDENTIALS`, `ACCOUNT_PENDING`, `ACCOUNT_REJECTED`, `PASSWORD_CHANGE_REQUIRED`, `EMAIL_DOMAIN_NOT_ALLOWED`, `OTP_INVALID`, `OTP_EXPIRED`, `NETWORK_BLOCKED`, `WORKBOOK_TOO_LARGE`, `WORKBOOK_UNREADABLE`, `WORKBOOK_CHANGED`, `WORKBOOK_LOCKED`, `SERVICE_UNAVAILABLE`, `INTERNAL`. Codes are added to the catalog when the phase that uses them is built (Phase 0 has `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `WORKBOOK_CHANGED`, `REQUEST_TOO_LARGE`, `WORKBOOK_TOO_LARGE`, `WORKBOOK_UNREADABLE`, `RATE_LIMITED`, `INTERNAL`, `SERVICE_UNAVAILABLE`).
- The Rust service returns the same envelope and only these codes.
- Pages: friendly 404, 403, 500 and "network blocked", each with the support contact.

---

## 9. Environments, Files and Ports

| Env | File | Database | Drivers |
|:---|:---|:---|:---|
| development | `.env` | `jdsheets_dev` | storage `local` (`./storage/dev`), mail `fake`, validator `collab` or `fake`, `DEV_PRINCIPAL=on` in Phase 0 only |
| test | `.env.test` | `jdsheets_test` (must end `_test`) | storage `local` (`./storage/test`), mail `fake`, validator `fake` (contract and E2E tests use `collab`) |
| production | `.env.production` | managed in the Docker volume | storage `local` or `s3`, mail `smtp`, validator `collab`; `fake`, `DEV_PRINCIPAL` and `NETWORK_ENFORCEMENT=off` refused |

Ports: app 47320, collab 47321, Postgres 47322, full-stack Caddy 47324, GridCraft preview 47325; tests: app 47330, collab 47331. Always `127.0.0.1`.

---

## 10. Testing Strategy (summary)

See Decision 24 and `TDD_INSTRUCTION_GUIDE.md`. Test-first for access, workbook roles, IP rules, sign-up/OTP/approval, sessions, the token contract, saving and conflicts, leases, jobs, the bridge protocol and all collaboration logic. E2E only for the eight critical journeys. The canvas grid is driven with the keyboard and checked through the API or the saved file.

---

## 11. Open Questions

| ID | Question | Needed by |
|:---|:---|:---|
| Q-01 | GridCraft release tag to pin first (Decision 38) | W-001 |
| Q-02 | Git repository name, owner and visibility (Decision 39) | W-001, W-015 |
| Q-03 | Office and VPN IP ranges; are they static? (Decision 40) | Phase 1 |
| Q-04 | Google account and app password for OTP mail (Decision 40) | Phase 1 |
| Q-05 | Production domain and DNS (Decision 41) | Phase 4 |
| Q-06 | Backup target (Decision 41) | Phase 4 |
| Q-07 | Hostinger VPS plan (Decision 37) | Phase 4 |
