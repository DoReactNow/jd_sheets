# Architecture & Design Decisions Log: JD Sheets

This document records every significant design decision for **JD Sheets**, with its reasons and trade-offs. Every architectural change or non-obvious choice is logged here **before** it is built. If a proposal contradicts a logged decision, flag it and ask the owner first.

**Statuses:** Accepted, Amended, Superseded, Resolved, Open (still pending, with the phase that needs it).

**Amendments:** when a later decision changes an earlier one, the earlier entry keeps its history and its status line names the newer decision. Always follow the newest decision.

**Origin:** decisions 1 to 41 were agreed with the owner in the planning conversation of 2026-11-05 and 2026-11-06, before any code existed. Many patterns are carried over from the Explore Hills CRM, which uses the same toolchain and has proven them in production-grade tests.

---

## A. Product and scope

### Decision 1: Product Scope: An Internal, IP-Restricted, Collaborative Spreadsheet

**Date:** 2026-11-06
**Status:** Accepted

#### Context
JD Fusion wants a spreadsheet that works in the browser like Google Sheets, reachable only from approved networks, with sharing, permissions and live collaboration. GridCraft (by the ArtCraft team) is a young, open-source spreadsheet written in Rust that also runs in the browser through WebAssembly. Its desktop installer does not fit; its web build and engine do.

#### Decision
- Build **JD Sheets**: a web application that wraps GridCraft's web build with sign-in, approval of new accounts, an IP allowlist, sharing with roles, version history and (Phase 3) live co-editing.
- GridCraft supplies the spreadsheet itself (grid, formulas, formatting, charts, comments, XLSX). JD Sheets supplies everything around it.
- GridCraft's own code is **never edited in place** (Decision 6), so upstream fixes can be pulled in at any time.

#### Consequences
- The spreadsheet looks and behaves like Excel (ribbon, canvas grid), not like Google Sheets. Restyling it would need a fork of GridCraft's UI, which this project refuses (Decision 6).
- Product quality of the grid depends on GridCraft's progress. The project tracks upstream weekly (Decision 33).

---

### Decision 2: Single Company

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
One deployment serves one company, JD Fusion. There is no organisation table and no tenant column. The company's details (name, email domain, support contact) live in the single source of truth (Decision 29).

#### Consequences
Simpler schema and access rules. Supporting a second company later means adding a tenant model; this is not planned.

---

### Decision 3: No DPDP Compliance Features

**Date:** 2026-11-06
**Status:** Accepted (owner's decision)

#### Decision
JD Sheets is an internal tool. It does not get the consent, export or erasure features or the DPDP checklist that the Explore Hills CRM has.

#### Note recorded for the owner (not legal advice)
Being internal does not by itself take a system outside India's Digital Personal Data Protection Act if sheets hold employee personal data (salaries, phone numbers, ID numbers). What would still apply is mainly **reasonable security safeguards and breach reporting**. Those are covered by design anyway: IP allowlist, sign-in, approval, roles on every workbook, audit trail, HTTPS, encrypted off-server backups (Decisions 14, 16, 18, 37). If that changes, revisit this decision.

---

## B. Architecture and stack

### Decision 4: Technology Stack

**Date:** 2026-11-06
**Status:** Accepted

#### Context
GridCraft is Rust. The team's existing, proven stack (Explore Hills) is Next.js + TypeScript + Prisma + Postgres, with a large set of tested foundations: the access guard, friendly errors, the time module, background jobs, the storage interface, CI and Docker.

#### Decision
| Part | Technology |
|:---|:---|
| Web app and API | **Next.js 16 (App Router) + TypeScript (strict)**, Node 22.12+ |
| Database access | **Prisma 7** + **PostgreSQL 17**. Prisma owns every migration, including the tables the Rust service uses |
| Validation | Zod, with friendly messages |
| Dates | Luxon, only inside `src/shared/time/` |
| Passwords | argon2id through `@node-rs/argon2` |
| Background jobs | pg-boss with a separate worker process |
| Mail (OTP only) | nodemailer with Google SMTP; a `fake` sender in development and tests |
| Engine and collaboration service | **Rust** (edition 2024, toolchain pinned to GridCraft's minimum, 1.95 at the time of writing), **axum + tokio**, **sqlx** (Postgres), depending on `gridcraft-engine` from the vendored source |
| Spreadsheet UI | **GridCraft's web build, unchanged**, built with `trunk` into static files and embedded in a same-origin iframe (Decision 7) |
| UI around the editor | React (in Next.js): file lists, share dialog, version history, admin screens |
| Tests | Vitest (unit and integration), Playwright (E2E), `cargo test` with proptest (Rust) |
| Edge | Caddy: HTTPS, IP allowlist, static editor files |
| Hosting | Hostinger VPS with Docker Compose (Decision 37) |

#### Why not Rust for the whole server
Rust earns its place only where GridCraft's engine must run on the server: validating workbooks and (Phase 3) holding the authoritative copy of each workbook during live co-editing. Everything else (accounts, sessions, roles, sharing, admin screens) is ordinary web work where the Next.js foundations already exist and are tested. Two languages are kept apart by one narrow, contract-tested boundary (Decision 10).

---

### Decision 5: Modular Monolith Plus One Rust Service

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- The Next.js app is **one deployable modular monolith**: `src/modules/<module>/` with controller, service, repository, schemas, types, UI and tests, and one public entry point (`index.ts`). Boundaries are enforced by `dependency-cruiser` (`npm run lint:arch`), as in Explore Hills.
- Layering inside every module: `route.ts → controller → service → repository → database`. Routes are thin adapters; controllers declare access and parse input; services hold business rules; repositories hold Prisma queries and write only their own module's tables. Cross-module foreign keys are allowed, `onDelete: Restrict` by default, never `Cascade`.
- **One extra deployable:** `services/collab/`, a Rust service that is the **only** code depending on GridCraft's engine. It owns no users, roles or business rules. It trusts only short-lived tokens issued by the app (Decision 10).
- The worker process (pg-boss) is a second entry point of the same Next.js codebase, as in Explore Hills.

#### Consequences
Three processes in production (app, worker, collab) plus Postgres and Caddy. The Rust service can be developed and tested on its own.

---

### Decision 6: GridCraft Is Vendored as a Pinned Git Submodule and Never Edited

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- GridCraft lives at `vendor/gridcraft` as a **git submodule pinned to a release tag**. Files inside it are never edited.
- Our code touches GridCraft in exactly **two places**:
  1. **The editor bridge** (`src/modules/editor/bridge/`): the `postMessage` protocol of GridCraft's host mode.
  2. **The Rust service** (`services/collab/src/engine/`): the only Rust module that imports `gridcraft-engine`.
  Upstream breaking changes are fixed in those two places only.
- Updating GridCraft is a one-line bump of the submodule, done by the weekly upstream job (Decision 33) only when every test passes.
- Licence: GridCraft is MIT or Apache-2.0. Keep its `LICENSE-*` and `NOTICE` files with the built editor; never use the GridCraft or ArtCraft names or logos as our branding.

---

### Decision 7: The Editor Is Embedded Through GridCraft's Host Mode

**Date:** 2026-11-06
**Status:** Accepted

#### Context (from reading GridCraft v0.16.0)
`apps/gridcraft-web` has a host bridge (`src/host.rs`, built on `craft-web-host`). In an iframe opened with `?host=parent`, it talks to a **same-origin** parent page over `postMessage`:
- `gridcraft:ready` (to the page) when it is listening;
- `gridcraft:open { name, bytes }` (from the page) to open a workbook (refused above 512 MiB);
- `gridcraft:save { name, saveAs, bytes }` (to the page) instead of downloading, for Save, Save As and PDF export;
- `gridcraft:dirty` when unsaved changes appear or go away; `gridcraft:failed` when it cannot start;
- `?author=` sets the user's name on new notes and comments.

#### Decision
- The built editor is served **from our own origin** at `/editor/` (by Next.js in development, by Caddy in production). A parent on another origin gets no bridge, so this is required.
- The editor page (`/w/<id>`) is a React page that hosts the iframe and runs our bridge: fetch the workbook bytes from our API, send `gridcraft:open`, receive `gridcraft:save` and `PUT` the bytes back, show the save state from `gridcraft:dirty`.
- `?author=` carries the signed-in user's display name.
- The iframe gets a strict content security policy and no permissions beyond what GridCraft needs.

---

### Decision 8 (superseded by Decision 55): Changes GridCraft Needs: Proposed Upstream, Patched Locally Meanwhile

**Date:** 2026-11-06
**Status:** Accepted (owner chose the recommendation)

#### Context
GridCraft lacks two things JD Sheets needs:
1. **An access mode** set by the host page (`view`, `comment`, `edit`). Today it always lets the user type in cells; there is no read-only mode. Needed in Phase 2 for Viewers and Commenters.
2. **Command messages** over the host bridge: every engine command run in the editor is sent out (`gridcraft:command`), and commands from the host are applied (`gridcraft:apply`). Every edit in GridCraft is already a command (`Session::execute(id, params)`, 313 commands, a replayable journal), so this is a small change in `apps/gridcraft-web`. Needed in Phase 3 for live co-editing. GridCraft's own gap list (`docs/gaps.md` §16) lists co-authoring as not built.

#### Decision
- For each change: open an issue and a pull request on `storytold/gridcraft` **and** keep the same change as a patch in `patches/gridcraft/NNNN-<name>.patch`, applied to a copy of the source at editor build time (`npm run editor:build`). The submodule itself stays untouched.
- Rules for patches: as small as possible; only in `apps/gridcraft-web` and, if unavoidable, the UI crate's public entry points; each patch has a header naming its upstream pull request; patch-specific tests live in our repository.
- When upstream merges a change, the patch is deleted in the same pull request that bumps the submodule.
- A patch that stops applying fails the weekly upstream job (Decision 33), which then opens an issue instead of bumping.

#### Consequences
- Live co-editing and view/comment modes ship on our schedule.
- Cost: a patch may need refreshing when upstream changes the same lines. Kept small to keep this cheap.

---

### Decision 9: The Server Is the Real Lock; the Editor Mode Is Only for a Clean Experience

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- Every save, every edit command (Phase 3) and every comment is checked on the server against the user's workbook role (Decision 15). A Viewer can never change a stored workbook, even by calling the API directly or by editing the iframe in developer tools.
- The editor's access mode (Decision 8) only hides or disables what the role cannot do, so nobody types something that is then refused.
- Known limit, accepted: the whole workbook is sent to every person who may open it. A Viewer sees every cell. Data some people must not see belongs in a separate workbook. Hidden sheets and sheet protection are not security.

---

### Decision 10: The Token Contract Between the App and the Rust Service

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- The browser gets a **collab token** from the app (`POST /api/workbooks/:id/collab-token`) after the normal session, IP and workbook-role checks. It connects to the Rust service with that token.
- Format: JWT, HS256, secret `COLLAB_TOKEN_SECRET` (shared by app and service through env only).
- Claims: `iss = "jd-sheets-app"`, `aud = "jd-sheets-collab"`, `sub` (user ID), `sid` (session ID), `wb` (workbook ID), `role` (`EDITOR` | `COMMENTER` | `VIEWER`; an Owner is sent as `EDITOR` plus `own: true`), `ip` (client IP as the app saw it), `name` (display name, for presence), `iat`, `exp` (**5 minutes**), `jti`.
- The service refuses: a bad signature, wrong issuer or audience, an expired token (30-second clock leeway), and a connection from an IP different from `ip`.
- The client refreshes the token over the open connection before it expires. The app can also push a change to the service (`POST /internal/access-changed`) so a role downgrade or a removed share takes effect at once (Phase 3).
- Service-to-app calls (Rust → Next.js) use `INTERNAL_SERVICE_TOKEN` in a header on routes declared `access: 'internal'`, reachable only on the private Docker network.
- **Contract tests:** shared fixtures in `contracts/collab-token/` (valid, expired, wrong audience, wrong signature, IP mismatch, unknown role). The TypeScript issuer tests and the Rust verifier tests both read them, so the two sides cannot drift.

---

### Decision 11: Workbook Validation Runs in the Rust Service

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- Every uploaded or saved workbook is checked before it is stored: size limit (Decision 17), file signature (ZIP / XLSX), and a **real open through GridCraft's engine** by the Rust service (`POST /internal/workbooks/validate`). A file the engine cannot open is refused with a friendly message.
- The app calls the service through a `WorkbookValidator` interface; tests use a `fake` validator except the contract and end-to-end tests.
- This is built in Phase 0, so the app ↔ Rust ↔ engine path is proven from the first week.

---

## C. Accounts, sign-in and access

### Decision 12: Accounts: Admin-Created, or Self Sign-Up With Email OTP and Admin Approval

**Date:** 2026-11-06
**Status:** Accepted (owner's decision)

#### Decision
- **Only `@jdfusion.in` email addresses, everywhere**: self sign-up, admin-created accounts, email changes, and the first Super Admin seed. The check compares the part after the last `@`, lower-cased and trimmed, to exactly `jdfusion.in`. Subdomains (`x.jdfusion.in`), look-alikes (`jdfusion.in.evil.com`, `jdfusion-in.com`), quoted local parts, several `@` and Unicode look-alike characters are refused. The domain lives in the single source of truth, and a database check constraint enforces it too.
- **Admin-created accounts:** an admin enters name, email, role and a temporary password. The account is `ACTIVE` with `mustChangePassword = true`. No OTP.
- **Self sign-up:** 1) the person enters their email; 2) an OTP is emailed; 3) they enter the OTP; 4) they set name and password; 5) the account is created as `PENDING_APPROVAL`. A pending account can sign in only to see "waiting for approval"; every other page and API is refused.
- **Approval:** a user with `users:approve` approves (choosing a role) or rejects. Approved → `ACTIVE`. Rejected → `REJECTED`; the person sees a friendly "not approved" message on sign-in. A rejected email may sign up again (new OTP); the request returns to `PENDING_APPROVAL` and the admin sees that it was rejected before. Every step is audited.
- **Account statuses:** `PENDING_APPROVAL`, `ACTIVE`, `REJECTED`, `DEACTIVATED`. Only `ACTIVE` users get a working principal.
- No answer reveals whether an email already has an account: asking for an OTP always gives the same message ("If this address can be used, we have sent a code").

---

### Decision 13: Email Is Sent Only for Sign-Up OTPs, Through Google SMTP

**Date:** 2026-11-06
**Status:** Accepted (owner's decision)

#### Decision
- The app sends **one kind of email only: the sign-up OTP**. There are no notification emails (approval, rejection, sharing, comments). People learn about these inside the app: the pending and rejected screens, the "Shared with me" list, and the approval queue's count for admins.
- Sender: **Google SMTP** (a Gmail or Google Workspace account with an app password), through nodemailer, behind a `Mailer` interface. Env: `MAIL_DRIVER` (`fake` | `smtp`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`.
- `fake` is the only driver in development and tests; it stores messages in memory (tests read the OTP from it). `fake` is refused in production.
- Sending happens in a background job (`mail.sendOtp`), so a slow SMTP server never slows a request.
- Gmail sends about 500 messages a day (about 2,000 for Workspace). That is enough for sign-up OTPs.

**OTP rules:** 6 digits; valid 10 minutes; single use; stored only as a hash (HMAC-SHA-256 with `OTP_PEPPER`); 5 wrong tries end that OTP; one resend per 60 seconds; at most 5 OTPs per email per hour and 20 per IP per hour; requesting a new OTP voids the previous one.

---

### Decision 14: Sign-In, Sessions and Lockout

**Date:** 2026-11-06
**Status:** Accepted (same design as Explore Hills Decision 46; OTP not asked at sign-in, owner's decision)

#### Decision
- Sign-in with email and password only. **No OTP or second factor at sign-in.**
- Own `identity_sessions` table, not Auth.js. Session token: 32 random bytes in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); the database keeps only its SHA-256 hash.
- A session ends after **12 hours without activity**, and at most **7 days** after sign-in. Activity extends it at most once every 5 minutes.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes; at most 20 sign-in attempts per IP per 15 minutes (counted in Postgres).
- One message for a wrong email or a wrong password (`INVALID_CREDENTIALS`).
- Requests that change data and carry a session cookie must come from `APP_URL`'s origin.
- `mustChangePassword` users can only reach the change-password screen until they change it.
- Password rule: 12 to 128 characters, not equal to the email, not only spaces. One shared rule, used by sign-up, admin-created accounts, resets and the seed.

---

### Decision 15: Password Reset Is Done by an Admin Only

**Date:** 2026-11-06
**Status:** Accepted (owner's decision)

#### Decision
- There is **no self-service "forgot password"**. The sign-in page says: "Forgot your password? Ask an admin to reset it."
- A user with `users:reset-password` sets a temporary password; the account gets `mustChangePassword = true` and **all its sessions are signed out**. Audited.
- An Admin cannot reset a Super Admin's password; only another Super Admin can.
- **If the only Super Admin is locked out:** a server command run on the VPS, `npm run admin:reset-super-admin -- --email <email>`, asks for a new password on the terminal (never on the command line), sets it with `mustChangePassword = true`, signs out their sessions and writes an audit event with actor `system`.
- The last active Super Admin cannot be deactivated or demoted (`CONFLICT`).

---

### Decision 16: Global Roles and Permissions (RBAC)

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- Same mechanism as Explore Hills: permission codes `resource:action` in one registry (`src/shared/rbac/permissionRegistry.ts`); roles are bundles stored in the database; the principal is rebuilt on every request; a guard in front of every route defaults to deny; every `route()` declares its access; public routes are an explicit allow-list; a test scans all routes.
- **System roles:** `SUPER_ADMIN` (bypasses the global permission check, through the guard only), `ADMIN`, `MEMBER`. Defaults in `defaultRoles.ts`, applied by an idempotent `db:sync-rbac`.
- **Reserved codes** (`users:manage-super-admins`, `roles:manage`) are never granted to any role; only the bypass reaches them.
- **No custom-roles page** in the first version. The three system roles cover the need; a Roles & Permissions page can be added later as its own decision.
- Feature code never checks role names.
- Full catalogue: `project_data.md` Section 5.

---

### Decision 17: Workbook Roles, Sharing and What a Super Admin May Open

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- Access to a workbook is separate from the global RBAC of Decision 16. Each workbook has exactly one **Owner**, and **grants** of `EDITOR`, `COMMENTER` or `VIEWER` to a user or a group (groups arrive in Phase 2). An optional **company link** gives every active user a chosen role (`VIEWER` or `COMMENTER` or `EDITOR`) once they open the link; it is still behind sign-in and the IP allowlist.
- A person's effective role is the **highest** of: owner, direct grant, group grants, company link.
- Matrix (full detail in `project_data.md` Section 5.5):

| Can… | Owner | Editor | Commenter | Viewer |
|:---|:---:|:---:|:---:|:---:|
| Open and read | ✓ | ✓ | ✓ | ✓ |
| Download / export a copy | ✓ | ✓ | ✓ | ✓ (unless the owner turns it off) |
| Add, reply to, resolve comments | ✓ | ✓ | ✓ | ✗ |
| Change cells, sheets, formatting; save | ✓ | ✓ | ✗ | ✗ |
| See version history; restore a version | ✓ | ✓ (restore) | see only | ✗ |
| Share, change roles, company link | ✓ | ✗ | ✗ | ✗ |
| Rename | ✓ | ✓ | ✗ | ✗ |
| Transfer ownership, move to trash, delete | ✓ | ✗ | ✗ | ✗ |

- A person with **no** role on a workbook gets `NOT_FOUND`, never `FORBIDDEN`, so its existence does not leak; it never appears in their lists, counts or search.
- **Super Admin and workbooks:** the global bypass does not grant workbook roles. A Super Admin (or a role holding `workbooks:administer`) can see the list of all workbooks with owners and sizes, transfer ownership (for example when someone leaves) and delete; opening a workbook's content they do not have a role on requires an explicit **"open as administrator"** action that asks for a reason and is always audited.
- When a user is deactivated, their workbooks stay; an admin transfers ownership.

---

### Decision 18: IP Allowlist in Two Layers

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- **Layer 1, edge (Caddy):** only the CIDR ranges in `EDGE_ALLOWED_CIDRS` (env on the server) reach the app at all. Everyone else gets a static "Not available from this network" page with status 403. Changing it needs server access, so it is the coarse wall (office networks, VPN).
- **Layer 2, app:** the `network_ip_rules` table, managed on the **Network access** page by users with `network:manage`. Checked on every request (pages, API, the editor files' API calls, the collab-token issue) in `src/proxy.ts` plus the route wrapper. The token carries the IP and the Rust service compares it (Decision 10).
- The client IP is taken from `X-Forwarded-For`, trusting exactly `TRUSTED_PROXY_HOPS` proxies (1 with Caddy in front). Spoofed extra entries are ignored. IPv4 and IPv6 are both supported; IPv4-mapped IPv6 is normalised.
- **Safety rules:** saving a rule set that would exclude the admin's own current IP is refused (`CONFLICT`, with a friendly message). An empty rule set is not allowed while enforcement is on. The env value `BOOTSTRAP_ALLOWED_CIDRS` seeds the first rules. A server command, `npm run admin:reset-ip-rules -- --cidr <cidr>`, recovers from a lock-out.
- `NETWORK_ENFORCEMENT` = `on` in production (refused `off`), `off` by default in development and tests except the tests of this feature.
- Every blocked request is counted and logged (IP, path, time), never with personal data from the body.

---

## D. Workbooks, storage and collaboration

### Decision 19: File Storage Behind an Interface; No File Bytes in the Database

**Date:** 2026-11-06
**Status:** Accepted (same pattern as Explore Hills Decisions 26 and 44)

#### Decision
- `FileStorage` interface (`put`, `get` as a stream, `delete`, `exists`, `stat`), drivers `local` (disk) and `s3` (any S3-compatible service), chosen by `STORAGE_DRIVER`. Only `src/shared/storage/registry.ts` imports a driver. Every driver passes a shared contract suite.
- Production starts with `local` on a Docker volume on the VPS, with nightly off-server backups (Decision 37). Moving to S3 is a setting change plus a copy.
- Workbook bytes are never stored in the database. Storage keys never contain names, emails or titles: `workbooks/<workbookId>/<versionId>.xlsx`.

---

### Decision 20: Saving: Full Snapshots as Versions, With Optimistic Concurrency

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- Every save stores the whole `.xlsx` as a new **version** (`workbooks_versions`), then moves `workbooks_workbooks.currentVersionId` to it in one transaction.
- A save names the version it was based on (`baseVersionId`). If the workbook has moved on, the save is refused with `CONFLICT` and nothing is overwritten. The editor offers "reload the latest" or "save as a copy".
- Size limit `WORKBOOK_MAX_BYTES` = **50 MiB** by default (single source of truth), checked before the body is read fully.
- **Version retention:** keep every version for 30 days; after that keep one per day for 1 year, then one per month. Named versions (labelled by a user) are kept forever. Pruned by a background job. Values in the single source of truth.
- **Trash:** deleted workbooks go to Trash for 30 days, restorable by the owner, then purged (rows and files) by a job.

---

### Decision 21: Collaboration Comes in Two Steps: Edit Lease (Phase 2), Live Co-Editing (Phase 3)

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- **Phase 2, edit lease:** one person edits a workbook at a time. Opening a workbook as an Editor takes a lease (`workbooks_edit_leases`, 90 seconds, renewed every 30 seconds by the editor page). Others with edit rights open it in view mode with a banner "Asha is editing. You will be able to edit when they close it." They can ask for a refresh to see the latest saved version. A lease whose holder disappears expires by itself.
- **Phase 3, live co-editing:** the edit lease is replaced by the Rust service (Decision 22). The lease code stays as the fallback when the collab service is unreachable.

---

### Decision 22: Live Co-Editing Architecture (Phase 3)

**Date:** 2026-11-06
**Status:** Accepted (design direction; details settled when Phase 3 is planned)

#### Decision
- **The server is authoritative.** For each open workbook, the Rust service keeps one GridCraft engine `Session` in memory, loaded from the current version.
- Each editor sends commands (`gridcraft:command`, Decision 8) over a WebSocket with the sequence number it has seen. The service checks the role (Commenters may only send the comment commands `review.newComment`, `review.replyComment`, `review.resolveComment`, `review.deleteComment` on their own comments; Viewers may send none), applies the command to its `Session`, assigns the next sequence number, appends it to `collab_ops`, and broadcasts it. Every client applies commands in sequence order (`gridcraft:apply`).
- A command based on an old sequence number is **rebased** when the change in between cannot affect it, and **rejected with a resync** when it can (for example rows inserted above its target). Selection-dependent commands are sent with their explicit ranges. The exact rules are settled and tested in Phase 3.
- **Snapshots:** after 200 commands or 30 seconds of quiet, the service writes the workbook as `.xlsx` and hands it to the app (`POST /api/internal/collab/snapshots`, `access: 'internal'`), which stores it as a version through the normal path. On restart, the service loads the latest version and replays the commands after it.
- **Presence:** who is in the workbook, their colour and selected cell, kept in memory and broadcast.
- One service instance at first. Redis for sharing state across instances is added only if load testing in Phase 4 shows the need.

---

### Decision 23: Comments Are GridCraft's Own Threaded Comments

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- Comments are GridCraft's native threaded comments (`review.newComment`, `review.replyComment`, `review.resolveComment`, `review.deleteComment`). They live inside the workbook and travel with the `.xlsx`.
- The comment author is the signed-in user, set through `?author=` (Decision 7). In Phase 3 the service checks that the author on a comment command matches the token's user.
- There is no separate comment database and no comment notifications (Decision 13). A future "comments panel" with mentions would be a new decision.

---

## E. Engineering rules

### Decision 24: Test Strategy and Where Test-First Is Mandatory

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
**Test levels**
| Level | Tool | What |
|:---|:---|:---|
| Unit | Vitest | Service rules with a mocked repository, guard decisions, scope resolution, schemas, error mapping, time helpers, React components, architecture and SSOT scans |
| Integration | Vitest + the real test database | Route handlers with a real `Request`, through to `jdsheets_test`; status, body and database state afterwards |
| Rust | `cargo test`, proptest, real WebSocket clients, sqlx against the test database | Engine adapter, token verifier, validation, (Phase 3) ordering, rebasing, convergence, presence |
| Contract | Shared fixtures | Collab token (TS ↔ Rust), storage drivers, mailer, editor bridge messages |
| Editor bridge | Vitest (jsdom) with a scripted fake iframe, plus Playwright against the real GridCraft build | Open, save, dirty, mode, (Phase 3) command messages |
| Upgrade | Golden workbooks | A fixed set of `.xlsx` files must open, save and reopen with the same values, through the engine and through the editor, on every GridCraft bump |
| E2E | Playwright against the built app | Only the critical journeys below |

**Test-first is mandatory for:** the access guard and Super Admin bypass; workbook-role resolution and every workbook route's access; the IP allowlist and client-IP parsing; sign-up, OTP and approval; sessions and lockout; the collab token contract; saving and version conflicts; the edit lease; every background job; the editor bridge protocol; and in Phase 3 all collaboration logic (ordering, rebasing, role enforcement per command, convergence).

**Plain CRUD screens** may have tests written alongside the code, but the coverage list still applies (success, validation, 401, 403, not found, scope).

**E2E critical journeys (Playwright)**
1. Sign in as each role; a pending user sees only the waiting screen.
2. Self sign-up with OTP (read from the fake mailer), then admin approval, then first sign-in.
3. Create a workbook, type values and a formula, save, reload: the values are there.
4. Share with a Viewer and a Commenter: the Viewer cannot edit, the Commenter can comment only (Phase 2).
5. Version history: restore an older version (Phase 2).
6. A request from an IP outside the allowlist sees the blocked page (Phase 1).
7. Two browsers edit the same workbook live and both end with the same values (Phase 3).
8. The friendly 404, 403 and 500 pages.

**The grid is a canvas.** E2E tests type with the keyboard into the canvas and check results through the API or the saved file, never by reading cells from the page.

---

### Decision 25: Time and Dates

**Date:** 2026-11-06
**Status:** Accepted (same as Explore Hills Decision 6)

#### Decision
- Instants are stored as `timestamptz` in UTC; business dates as `date`. Business timezone `Asia/Kolkata` in the single source of truth.
- All date logic goes through `src/shared/time/` with an injected `Clock`; `new Date()`, `Date.now()` and `toLocale*` are refused elsewhere by ESLint.
- In Rust, time comes through a `Clock` trait so tests control it.
- Note: dates **inside** workbooks are GridCraft's business (Excel date serials) and are never converted by our code.

---

### Decision 26: Friendly Errors Only

**Date:** 2026-11-06
**Status:** Accepted (same as Explore Hills Decisions 8 and 36)

#### Decision
- Every failure maps to a code in one error catalog (`src/shared/errors/catalog.ts`) with a friendly message. Response envelope: success `{ data }`, failure `{ error: { code, message, fieldErrors?, requestId } }`.
- Users never see a stack trace, SQL, a table or library name, a permission code or an internal ID. Unexpected failures show a reference that is also in the server log.
- The Rust service returns the same envelope and only catalog codes; the app maps them for the user. The editor shows its own GridCraft messages only for spreadsheet errors (formulas and so on).

---

### Decision 27: Environments, Isolated Tests, 127.0.0.1 and Uncommon Ports

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- Env files: `.env` (development), `.env.test` (tests only), `.env.production` (server only). Examples (`*.example`) are committed; the real files never are.
- `APP_ENV=test` refuses a database URL that does not end in `_test`. Production refuses `fake` drivers, development placeholders and `NETWORK_ENFORCEMENT=off`.
- Use `127.0.0.1`, never `localhost`, in code, scripts and docs. No host, port, URL or secret in code; everything through `src/shared/config/env.ts` (TS) and `services/collab/src/config.rs` (Rust).
- Ports: app **47320**, collab service **47321**, Postgres **47322**, local full-stack Caddy **47324**, standalone GridCraft preview **47325**; the test run uses app **47330** and collab **47331**. (Explore Hills uses the 47210s, so both can run at once.)

---

### Decision 28: Seeds

**Date:** 2026-11-06
**Status:** Accepted (same split as Explore Hills Decision 11)

#### Decision
- `db:sync-rbac`: permissions and system roles, idempotent, no secrets, runs in every environment.
- `prisma/seed-test.ts`: throwaway test users (one per role, plus pending and rejected users) and sample workbooks, only in the test database, with addresses like `admin.test@jdfusion.in`.
- `prisma/private/seed.ts` (git-ignored): the first Super Admin from `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`; the email must be `@jdfusion.in`.
- `db:seed:dev`: a few development users and sample workbooks (including GridCraft's sample workbooks) so the local app has something to show.

---

### Decision 29: Single Source of Truth

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
Company name, product name, allowed email domain, support contact, business timezone, size limits, OTP rules, session lengths, retention periods, port defaults and date formats live in `src/shared/config/appConfig.ts`. Rust reads the values it needs from env, and a test checks the Rust defaults equal the TypeScript ones. An SSOT scan test fails on literals outside the registry.

---

### Decision 30: Migrations

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- Prisma owns **all** migrations, including tables only the Rust service writes (`collab_ops`). sqlx in Rust uses runtime-checked queries against those tables, and the Rust integration tests run against the migrated test database.
- Never edit an applied migration. Migrations are backward compatible with the previous app version (expand, then contract). `db:migrate:check` runs in CI. Migrations run automatically on deploy, before the new app starts.

---

### Decision 31: Background Jobs With pg-boss and a Worker

**Date:** 2026-11-06
**Status:** Accepted (same as Explore Hills Decision 27)

#### Decision
Jobs are defined per module with `defineJob()` (name, Zod payload, handler, retry policy), run by a separate worker process, and are idempotent. Tests run them with `runPendingJobs()` and an advanced `Clock`; they never wait on real time. Planned jobs: `mail.sendOtp`, `identity.cleanupExpired` (OTPs, sessions, rate-limit rows), `workbooks.pruneVersions`, `workbooks.purgeTrash`, `workbooks.purgeOrphanFiles`.

---

### Decision 32: No Server-Sent Events; WebSocket Only for Collaboration

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
App lists (approval queue, shared with me) refresh on focus and by light polling. The only live channel is the collab WebSocket (Phase 3). The Explore Hills SSE foundation is not copied, which keeps Phase 0 smaller.

---

### Decision 33: CI, and the Weekly GridCraft Upstream Job

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- GitHub Actions with separate, named steps: install → lint (ESLint, architecture, SSOT) → typecheck → Rust fmt + clippy (`-D warnings`) → build app and worker → build Rust service → build editor (submodule + patches) → migrate check → unit → integration → Rust tests → contract tests → E2E. Build runs before tests.
- **Weekly upstream job:** fetch the newest GridCraft release tag; apply our patches; build the editor and the service; run golden workbooks, bridge tests, Rust tests and E2E. All green → open a pull request bumping the submodule. Anything red → open an issue naming the failing step. A human merges.
- Needs a GitHub repository (Decision 39, Open).

---

### Decision 34: Docker for Local and Production

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- `docker/docker-compose.local.yml`: Postgres with two databases (`jdsheets_dev`, `jdsheets_test`) for everyday work, and an optional full stack (app, worker, collab, Caddy).
- `docker/docker-compose.prod.yml`: Caddy, app, worker, collab, Postgres, with volumes for the database and workbook files. Multi-stage images: the editor and the Rust service are compiled in a Rust build stage; the runtime images contain no compilers.
- Containers reach each other by service name. Only Caddy publishes ports.

---

### Decision 35: Fast, Visible Base: a Walking Skeleton in Phase 0

**Date:** 2026-11-06
**Status:** Accepted (owner asked to see the product locally as early as possible)

#### Decision
- The first work item builds GridCraft's web version from the submodule and serves it on `127.0.0.1`, so the owner sees the spreadsheet the same day.
- Phase 0 ends with **our** app on `127.0.0.1:47320`: a file list, "New workbook", the editor opening inside our page, Save storing a new version, and the workbook reopening after a reload.
- There is no sign-in in Phase 0. Requests run as a **development principal** (`DEV_PRINCIPAL=on`) that is refused by the env loader unless `APP_ENV=development` or `test`, with a test proving it. Phase 1 removes it from development.
- The rest of the foundation (errors, time, RBAC mechanics, tests, CI, Docker) is built around this path, test-first.

---

### Decision 36: Bigger Phases, Each Completed in One Go

**Date:** 2026-11-06
**Status:** Accepted (owner's instruction)

#### Decision
- Five phases (0 to 4) instead of many small ones. Each phase is planned in detail when it starts (from the code that exists then), then built completely on one branch and one pull request, without stopping between work items. Stop only for an Open decision or something only the owner can provide; ask those questions together at the start of the phase.
- Every scenario of a phase in `test_scenarios.md` maps to a real test, by ID, or is moved to a named later phase with the reason.

---

### Decision 37: Production on a Hostinger VPS

**Date:** 2026-11-06
**Status:** Accepted (owner's decision; the exact plan and size are settled in Phase 4)

#### Decision
- One Hostinger KVM VPS running Docker Compose (Decision 34). Suggested starting size: 4 vCPU, 16 GB RAM, 200 GB NVMe (the Rust service keeps open workbooks in memory). Confirmed by the Phase 4 load test.
- Hostinger's firewall allows only 80 and 443 from the internet, and 22 only from the owner's IPs. SSH keys only, no password login.
- Caddy gets HTTPS certificates automatically for the chosen domain (Open, Decision 41).
- Nightly encrypted off-server backups of the database and the workbook volume, with a restore drill before go-live. The backup target is settled in Phase 4.

---

## F. Open decisions

### Decision 38: GridCraft Release to Pin First

**Date:** 2026-11-06
**Status:** Resolved by Decision 42 (v0.16.1, the newest release when W-001 ran)

---

### Decision 39: Git Repository and GitHub Remote

**Date:** 2026-11-06
**Status:** Resolved (owner, 2026-11-06): `https://github.com/DoReactNow/jd_sheets`, default branch `main`. Phase 0 is built on the branch `phase-0-foundation` and merged by pull request (Decision 36).

---

### Decision 40: Office IP Ranges and Google SMTP Account

**Date:** 2026-11-06
**Status:** Resolved by Decisions 46 and 47 (owner's answers, 2026-11-06)
- The public IP addresses or ranges of every office and VPN that must reach JD Sheets, and whether they are static. Dynamic home IPs need a VPN.
- The Google account that sends OTPs (address, and an app password created by the owner). Development and tests never need it.

---

### Decision 41: Production Domain and Backup Target

**Date:** 2026-11-06
**Status:** Resolved by Decisions 59 and 60 (owner's answers, 2026-11-06)
- The domain or subdomain (for example `sheets.jdfusion.in`) and who manages its DNS.
- Where nightly backups go (for example Google Drive, Backblaze B2, or a second VPS).

---

## G. Settled while building Phase 0

### Decision 42: GridCraft v0.16.1 Pinned; Toolchain Details

**Date:** 2026-11-06
**Status:** Accepted (resolves Decision 38)

#### Decision
- `vendor/gridcraft` is pinned to **v0.16.1** (commit `e581bc95b2a1`), recorded in `vendor/GRIDCRAFT_VERSION`.
- The Rust toolchain is pinned to **1.95.0** (GridCraft's `rust-version`) in `services/collab/rust-toolchain.toml`; the editor is also compiled with it (`RUSTUP_TOOLCHAIN`).
- **trunk 0.22.1** needs a newer compiler (1.96.1+) to build itself, so it is installed with the stable toolchain (`npm run setup:rust`). Only the tool, not our code, uses the newer compiler.
- **wasm-bindgen-cli 0.2.129** (the exact version in GridCraft's lockfile) is installed locally and in CI, because trunk's own download of it timed out on the first build.
- The Rust service is its own Cargo workspace with **path dependencies** on the vendored crates (`engine`, `model`, `core`, `xlsx`); Cargo resolves GridCraft's inherited workspace fields. Its `Cargo.lock` was seeded from GridCraft's, so shared dependencies stay at the versions upstream tested.
- First editor build: about 4 minutes cold, 42 seconds warm, on the owner's Mac. The WebAssembly file is about 24 MB uncompressed (Caddy compresses it).

---

### Decision 43: Editor Embedding Details at v0.16.1

**Date:** 2026-11-06
**Status:** Accepted (amends Decision 7 and project_data.md 4.6)

#### Context (read from `apps/gridcraft-web/src/host.rs` at v0.16.1)
The pinned release's bridge is simpler than the later `craft-web-host` version the planning notes described: `gridcraft:save` carries `{ name, bytes }` (no `saveAs`), and there is no message by which the page can ask the editor to save.

#### Decision
- The editor is built with relative URLs (`--public-url ./`) and served by the **Next.js app** from `public/editor/` in every environment, so one set of headers applies (`next.config.ts`). Caddy only proxies. (Amends Decision 7 and Decision 34, which had Caddy serving the files.)
- The editor's only inline script (trunk's loader) is allowed by its **SHA-384 hash**, recorded in `public/editor/build-info.json` at build time; the editor's policy allows `'wasm-unsafe-eval'` and only our own pages may frame it.
- The iframe URL is `/editor/index.html?host=parent&chrome=notitlebar&author=<display name>`. GridCraft's own title bar is hidden (our top bar replaces it); its File tab stays, for Save and Export.
- **Saving is the person's Save** (Ctrl/Cmd+S or File › Save). Files other than `.xlsx` that the editor hands over (PDF exports) are downloaded by the page.
- **Autosave (Phase 2) needs patch 0001 to add a "save now" message** from the page to the editor, alongside the access mode. Logged here so Phase 2 plans for it.

---

### Decision 44: Phase 0 Implementation Details

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- **Kernel reuse:** the Explore Hills shared kernel (errors, `route()`, time, logger, jobs, storage, tests setup, scans) was copied and adapted, not rewritten.
- **Workbook roles in Phase 0:** the resolver is the real owner rule (the owner has `OWNER`, nobody else has a role), not a development shortcut. The development principal simply owns what it creates. Phase 2 replaces it with the `sharing` resolver.
- **Error codes:** a stale save answers `WORKBOOK_CHANGED` (409), with its own friendly message offering "reload" or "save as a copy". `REQUEST_TOO_LARGE` (413) was added for oversized non-workbook bodies.
- **Saving:** the file is written first; then, in one transaction that locks the workbook row (`SELECT … FOR UPDATE`), the version row is inserted and the pointer moved only if the base is still current. A unique (`workbook`, `number`) index is the second guard. Refused saves leave an orphan file, removed weekly by `workbooks.purgeOrphanFiles` after 24 hours.
- **Pages render per request** (`dynamic = "force-dynamic"` in the root layout), so each page gets its own CSP nonce; a prerendered page cannot carry one and its scripts would be blocked.
- **Validation:** the Rust service refuses archives declaring more than 1 GiB uncompressed or more than 20,000 entries before GridCraft reads them, runs GridCraft on the blocking pool with a 15-second limit, and turns a GridCraft panic into "unreadable".
- **The Rust service has no database access yet**; sqlx arrives with `collab_ops` in Phase 3.
- **Golden workbooks** are written by the pinned GridCraft from command specs (`golden/*.json`) and committed; tests open them, compare values, save and reopen.
- **Phase 0 E2E** runs the built app with `DEV_PRINCIPAL=on` (allowed under `APP_ENV=test`); Phase 1 replaces it with real test sign-in. Before typing into the canvas, E2E sends harmless keys (Escape, Ctrl+Home) because the first key after focus can be swallowed.
- **Docker:** one `docker/Dockerfile` with targets `migrator`, `app`, `worker`, `collab`; a `tools` stage builds trunk and wasm-bindgen with Rust 1.99.1. `npm run docker:check` proves non-root images without compilers and a create-and-save through Caddy.

---

### Decision 45: Phase 0 Acceptance (Fresh-Clone Drill) Findings

**Date:** 2026-11-06
**Status:** Accepted

#### Findings and fixes
- **`.gitignore` hid source code.** The pattern `storage/` also matched `src/shared/storage/`, so that folder never reached GitHub; the local checkout passed every test because the files existed on disk. Fixed: build and data folders are anchored to the root (`/storage/`, `/dist/` …). The drill (clone from GitHub, then every check) is the only test that can catch this, so it stays part of every phase's acceptance.
- **Cargo's built-in git client failed with an SSL error inside Docker** while fetching GridCraft's git dependencies. Fixed with `CARGO_NET_GIT_FETCH_WITH_CLI=true` in the Docker build stages.
- **The Docker editor build has no submodule git metadata**, so `scripts/editor-build.mjs` has a copy mode (`EDITOR_BUILD_SOURCE=copy`); CI's vendor check still guarantees the source is the pinned commit.
- **`npm run docker:check` stopped the everyday database** along with the full stack. Fixed: it stops only the full-stack services.

#### Result
From a fresh clone of the pull-request branch: lint, typecheck, builds, 232 unit, 50 integration, 33 Rust (including golden workbooks and contracts), 24 TypeScript contract and 4 E2E tests all passed. Docker: all four images build, run as non-root without compilers, and a workbook is created and saved through Caddy (`npm run docker:check`).

---

## H. Phase 1 decisions

### Decision 46: IP Ranges Change, So the App's Network Page Is the Real Wall

**Date:** 2026-11-06
**Status:** Accepted (owner: "they are not fixed, that's why we need a page for this in the admin portal")

#### Decision
- The office and VPN addresses are **not fixed**. Allowed ranges are managed on the **Network access** admin page (`network_ip_rules`), not in server files. A change applies within seconds (rules are cached for at most 5 seconds and the cache is cleared on every change).
- The **edge allowlist in Caddy is optional**: `EDGE_ALLOWED_CIDRS` may stay open (`0.0.0.0/0 ::/0`), so a changed office address never needs a server edit. (Amends Decision 18, layer 1.)
- **Where the rules apply:** every page (checked when the page is rendered) and every API route (in `route()`), including sign-in and sign-up. Exempt: `/api/health` (container health checks) and the static editor files (they hold no data; every workbook byte goes through the API). A refused page shows "This isn't available from this network"; a refused API call answers `NETWORK_BLOCKED` (403).
- **Self-lockout:** a change that would exclude the person's own current address is refused, the last enabled rule cannot be removed while enforcement is on, and every change is audited.
- **When the office address changes and nobody inside can reach the page**, the recovery command on the server adds the new range: `npm run admin:reset-ip-rules -- --cidr <range>`. A Super Admin may also sign in from anywhere and add the new range on the Network access page (Decision 57).

---

### Decision 47: Fake Mailer Until the Google Account Is Ready

**Date:** 2026-11-06
**Status:** Accepted (owner: "use fake mailer for now, we'll add that later")

#### Decision
- `MAIL_DRIVER=fake` everywhere for now; the `Mailer` interface and the `mail.sendOtp` job are built, and the SMTP driver is added when the owner provides the Google account (before go-live, Phase 4).
- The fake mailer keeps messages in the database table `mail_outbox` (not in memory), so the app, the worker and the tests see the same messages. In development the codes are also written to the server log, so sign-up can be tried locally. A test-only route reads the latest message for E2E (404 outside `APP_ENV=test`).
- Production still refuses `fake` (Decision 13), so self sign-up cannot go live without the real account.

---

### Decision 48: Phase 1 Technical Details

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- **One server secret for keyed hashes:** `AUTH_SECRET` (32+ characters) keys the OTP hashes, sign-up tickets and rate-limit buckets (replaces the planned `OTP_PEPPER`).
- **Sessions** follow Explore Hills Decision 46: SHA-256 hash of a 32-byte token in `identity_sessions`, cookie `jds_session` (`HttpOnly`, `SameSite=Lax`, `Secure` in production), 12 h idle, 7 days absolute, extended at most every 5 minutes.
- **The development principal is removed.** Development signs in like production; `db:seed:dev` creates development users with known development passwords (refused outside development). E2E signs in through the real form with test users.
- **Roles in the database:** `rbac_roles` and `rbac_role_permissions`, written by the idempotent `db:sync-rbac` (which never overwrites edited grants); the principal is rebuilt on every request.
- **Workbook owners:** the owner foreign key to `identity_users` is added now. Workbooks whose owner does not exist (Phase 0 development data) get no owner; Phase 2's administrator tools can assign them.
- **Audit events** are written in the same transaction as the change they describe; a database trigger refuses updates and deletes.
- **Mail and OTP jobs** run in the worker; tests run them with `runPendingJobs()`.

---

### Decision 49: Super Admin Access From Outside the Allowed Networks (resolved by Decision 57)

**Date:** 2026-11-06
**Status:** Resolved by Decision 57 (option b)

Because office addresses change, a change can leave everyone outside the allowed ranges until someone with server access runs the recovery command. Options: (a) keep it as is (server command only); (b) let **only Super Admins** sign in from anywhere, every such sign-in audited and shown on the Network page; (c) a one-time emergency code sent to the Super Admin's email. The current build is (a).

---

### Decision 50: Phase 1 Details Settled While Building

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- **Job names follow the module:** the code email job is `identity.sendOtp` (not `mail.sendOtp`), because the worker requires `<module>.<job>` names. The job makes the code itself, claims the hash before sending, and unclaims it if the send fails, so a retry sends a fresh code and a repeat sends nothing.
- **Pending and rejected people get no session.** The right password answers `ACCOUNT_PENDING` or `ACCOUNT_REJECTED`; the sign-in screen shows the status. A wrong password always answers `INVALID_CREDENTIALS`.
- **Client address:** Next.js fills `X-Forwarded-For` with the socket address only when no proxy set it, so `TRUSTED_PROXY_HOPS=1` is right both locally and behind Caddy. Without a proxy, a caller could send their own header; production always has Caddy in front.
- **The production first-run seed is committed** (`prisma/seed-private.ts`, `npm run db:seed:private`): it holds no secrets and reads `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` from the server's env file. (Amends Decision 28's git-ignored file.)
- **Development users** (`npm run db:seed:dev`): `owner.dev@`, `admin.dev@`, `asha.dev@`, `rahul.dev@` (all `@jdfusion.in`) with the development-only password printed by the seed.
- **Pages check the network in the root layout** and show the blocked page; pages needing a person redirect to sign-in, and to change-password when required; a page without the permission redirects to the friendly 403 page.

---

### Decision 51: Lighter Local Workflow

**Date:** 2026-11-06
**Status:** Accepted (owner: the Mac was heating up; asked what can run at intervals)

#### Decision
- Locally, a work item runs only the tests of the area it changes; the full suite runs **once per phase**, before the pull request. CI runs everything on every push.
- The **fresh-clone drill runs in CI only** (CI is a fresh clone).
- **Docker images are built only in Phase 4** (go-live) or in CI, not per phase locally.
- Rust and editor builds run only when GridCraft or the Rust code changes; background servers are stopped as soon as they are not needed.
- Progress is shown in the session's task list with a percentage per task.

---

## I. Phase 2 decisions

### Decision 52: Phase 2 Open Questions Answered (TQ-01 to TQ-05)

**Date:** 2026-11-06
**Status:** Accepted (owner: "Go, as recommended")

#### Decision
- **Deleting a group with shares (TQ-01, P2-GROUP-03):** the admin sees a warning listing the workbooks the group is shared on; confirming deletes the group and those shares in one transaction, audited. Without the confirmation flag the API answers `GROUP_IN_USE` with the count.
- **Company link in lists (TQ-02, P2-LINK-03):** a workbook reachable only through the company link appears in "Shared with me" and Recent only after the person has opened the link once (recorded as a link visit). Search follows the same rule.
- **Ownership transfer (TQ-03, P2-ADMINWB-02):** the old owner keeps a direct **Editor** grant; the new owner can remove it.
- **Same person, two tabs (TQ-04, P2-LEASE-08):** the lease belongs to one page (a lease id per tab), not to the person. A second tab opens in view mode with "You are editing this in another tab" and a "Move editing here" button, which takes the lease over explicitly; the first tab drops to view mode on its next renewal.
- **Autosave (TQ-05, P2-SAVE-01):** save 5 seconds after the last change, and at most 30 seconds after the first unsaved change while editing continues. Both values live in the single source of truth.

---

### Decision 53: Patch 0001 Upstream Pull Request Opened by the Owner

**Date:** 2026-11-06
**Status:** Accepted (owner: "Go, as recommended")

#### Decision
- Claude writes `patches/gridcraft/0001-access-mode.patch` and the upstream pull request text (`patches/gridcraft/0001-access-mode.upstream.md`). The owner opens the pull request on `storytold/gridcraft` (or tells Claude to open it from `DoReactNow`).
- Until then the patch header reads `Upstream: pending (see 0001-access-mode.upstream.md)`; the patch check (P2-MODE-01) accepts `pending` only together with that file, and Phase 4 acceptance requires a real link.
- **Done 2026-11-06** (owner: "Yes, open it"): https://github.com/storytold/gridcraft/pull/3463, from the `DoReactNow` fork. Upstream had moved its bridge to `craft-web-host`, so the pull request carries the gate and `?mode=`. The `gridcraft:mode` and `gridcraft:saveNow` messages need a `storytold/craft-libs` change first and are offered as a follow-up (details in `0001-access-mode.upstream.md`).

---

### Decision 54: Phase 2 Details Settled While Building

**Date:** 2026-11-06
**Status:** Accepted

#### Decision
- **Patch 0001 works after each frame, inside `apps/gridcraft-web` only.** GridCraft's UI calls the engine directly in about 60 places, so there is no single command gate within the allowed patch area. The patch's `access` module compares the workbook after every frame with what the mode allows and puts back anything else (view: nothing may change; comment: only the user's own comments and notes, plus their replies to others' threads), with a short notice. What a person only looks at (active sheet, zoom, scroll, page view) is never put back. In view mode Save hands no workbook to the page. **Not done:** greying out the ribbon's editing commands (part of P2-MODE-02); that needs a hook in `gridcraft-ui-egui` (outside Decision 8's area) and is offered upstream as a follow-up. The patch's tests run natively (`cargo test -p gridcraft-web` on the patched copy).
- **Commenter saves:** checked by the Rust service (`POST /internal/workbooks/diff-kind`), which rewrites both versions once through GridCraft and compares content without comments and view settings. The comment author is the display name the editor writes (`?author=`). A Commenter's save waits (`WORKBOOK_LOCKED`) while someone else holds the edit lease, so an editor's work is never overtaken.
- **Shares and link visits cascade with their workbook** (amends database_schema.md 3.14 "Restrict"), so deleting a workbook for good needs no call from `workbooks` into `sharing` (no circular dependency). Grant roles use a `share_role` enum without `OWNER`.
- **Deleting for good** works only from the Trash. **Any request through the company link** counts as opening it (Decision 52's "first open").
- **Administrator open:** the audit event's id is the permission to read the content for 15 minutes, in view mode; each open writes a new event.
- **Imports** are converted by the Rust service (`POST /internal/workbooks/convert`) with GridCraft's readers; the original name comes in the `x-file-name` header.
- **Editor tab id** (`x-editor-tab`) identifies the page holding the lease; `EDITING_ELSEWHERE` is a new catalog code for "you are editing in another tab".

---

### Decision 55: GridCraft Is Our Own Code

**Date:** 2026-11-06
**Status:** Accepted (owner: JD Sheets is internal only and will never be sold; "let's go with your recommendation" on all three questions). **Supersedes Decision 8 and Decision 53; amends Decisions 6 and 54.**

#### Decision
- `vendor/gridcraft` is a plain folder in our repository, no longer a submodule, and we edit it directly. Our copy is based on v0.16.1. Patch 0001 is folded in, and `patches/gridcraft/` is gone.
- We do not contribute upstream. The pull request storytold/gridcraft#3463 was closed with a short note, and the `DoReactNow/gridcraft` fork is to be deleted (the owner does this, see below).
- We stay on v0.16.1. There are no automatic updates: the weekly upstream job, its verify workflow, `upstream-bump.mjs` and the vendor-clean check are removed. If we ever need a specific fix from a GridCraft release, we copy it in by hand with a test.
- We keep GridCraft's `LICENSE-MIT`, `LICENSE-APACHE` and `NOTICE` files (the MIT/Apache licence allows private, modified, internal use, and asks only for that).
- Boundaries that stay: only `src/modules/editor/bridge/` names GridCraft messages, and only `services/collab/src/engine/` imports GridCraft crates.
- `npm run editor:test` runs the tests of our GridCraft changes.
- **Ribbon greying (completes P2-MODE-02):** `SheetApp` has an `access` setting (`Edit`, `Comment`, `View`). In view mode the ribbon disables every tab except View; in comment mode it also leaves Review usable. The after-each-frame rule of Decision 54 still applies everywhere else (keyboard, formula bar, context menus).
- **Phase 3:** the planned "patch 0002" (command messages) becomes direct changes, including to GridCraft's engine and UI where that is simpler.
- **Scenarios retired:** P0-EDIT-01 and P0-EDIT-02 (patches apply, and a broken patch names itself) and P2-MODE-01 (each patch names its upstream pull request) no longer apply.

---

## J. Phase 3 decisions

### Decision 56: Phase 3 Open Questions Answered (TQ-06 to TQ-09)

**Date:** 2026-11-06
**Status:** Accepted (owner: "go with your recommendation" on all four; about 25–30 staff, 15–20 people on one sheet at once, "like Google Sheets")

#### Decision
- **Undo (TQ-06, P3-PATCH-04):** each person undoes only their own changes, as in Google Sheets.
- **Same cell at the same moment (TQ-07, P3-REBASE-02, -03):** the change the server receives last wins for everyone. When someone inserts or deletes rows, columns or sheets, other people's pending edits and formula references shift with them. An edit that can no longer apply (its sheet was deleted) is refused, and that person's editor resyncs with a friendly message.
- **People per workbook (TQ-08, P3-PERF-03):** up to **25 editors at once** on one workbook (the owner expects 15–20), with any number of viewers. The next editor opens in view mode with a friendly message. Phase 4 load targets (TQ-10): about 30 staff, 20 people editing one workbook at once.
- **Versions during live editing (TQ-09, P3-SNAP-01, -03):** a version is saved every **10 minutes** while people are editing, and when the **last person leaves**. It is labelled "Live editing" with the names of everyone who changed it. Between versions nothing is lost: every accepted change is stored in `collab_ops` at once (P3-RECOV-01). This replaces the "200 commands or 30 seconds" rule in test_scenarios.md.
- **Performance target (P3-PERF-01):** a change reaches the others within 300 ms (95th percentile) on the office network with **20** editors.

---

### Decision 57: Super Admins Sign In From Any Network (resolves Decision 49)

**Date:** 2026-11-06
**Status:** Accepted (owner: "super admin can login from anywhere from any network, other than the super admin, everyone will have access on only allowed IP network")

#### Decision
- A signed-in **Super Admin** passes the network rules from any address. Everyone else, and anyone not yet signed in, still needs an allowed network.
- The sign-in page stays reachable from any address, so a Super Admin can sign in (a normal user signing in from outside gets the blocked page after sign-in, and no session is kept). The sign-in rate limits and lockout apply as before.
- A Super Admin's sign-in from outside is always audited (`network.outsideAccess`); their requests from outside are audited at most once per person and address every 10 minutes. Both show on the Network access page. Someone else signing in from outside is audited as `auth.sign_in_refused_network`.
- Caddy's edge allowlist (`EDGE_ALLOWED_CIDRS`, Decision 46) must therefore allow everything, and the app's network rules do the filtering (Phase 4 sets this up).
- Built as the first work item of Phase 3 (W-301).

---

### Decision 58: Phase 3 Details Settled While Building

**Date:** 2026-11-06
**Status:** Accepted (amends Decision 22 and database_schema.md 3.15)

#### Decision
- **Replay, proven first.** GridCraft's macro recorder already keeps each command with its sheet and selection. Our engine's `live` module captures every change as such a step, and another session replays it exactly. Proven on all 120 commands that change a workbook, including through JSON. Changes:
  - **Paste** carries its copied cells.
  - **Toggles** (Bold) are sent with the state they set.
  - **View-only commands** (selection, sheet tabs, zoom, windows) are never sent.
- **Where the rules live.** All of these are in our GridCraft's engine (`crates/engine/src/live.rs`) and are tested there with up to 8 simulated editors, random delays and row/column edits:
  - the editor side (pending changes, rewind and re-apply);
  - the server side (ordering, roles, comment authors, retries);
  - the shifting rule (Decision 56: pending changes shift through others' row and column inserts and deletes; a change to deleted cells is refused and its sender resyncs).
  
  The Rust service only does networking and storage.
- **Undo while live** restores this person's changed cells where nobody changed them since, as a normal change everyone receives (`live.setCells`). A structural change (rows, sheets, merges) can't be undone while others edit; a short message says so.
- **Storage through the app** (amends "written only by the Rust service"). The Rust service never touches the database: it calls the app's internal routes to load a workbook, store each accepted change *before* anyone hears of it, and save versions.
  - `collab_ops.baseVersionId` is the version a change builds on. After a restart the service loads the current version and replays the changes built on it.
  - A "Live editing" version becomes the next base; a normal save or a restore starts a new one.
  - Old changes are pruned nightly after 7 days (`collab.pruneOps`).
- **Versions while live (Decision 56):** every 10 minutes, when the last person leaves, and when someone presses Ctrl/Cmd+S ("save a version now"). Labelled with contributors and no single author.
- **Live editing and the one-editor lease never both allow editing (P3-FALLBACK-02).**
  - The service marks the workbook as edited live (`live_until`, renewed every 30 s); meanwhile nobody can take the lease.
  - While someone holds the lease, a live token is view-only.
  - The editor falls back to the lease only when it can't reach the live service at all (P3-FALLBACK-01).
- **Access changes** (shares, group members, deactivation, Trash) close the affected live connections; they reconnect with a fresh token. A restore reloads the live workbook for everyone.
- **WebSocket protocol:**
  - The first message carries the token, never the address.
  - Size limit 8 MB (a paste carries its cells); 300 messages per 10 seconds; a close jumps the queue.
  - With no proxy in front (local runs) the socket address stands in for the forwarded address, as the app does (Decision 50).
  - The browser uses `COLLAB_PUBLIC_URL` (default: `COLLAB_URL` as `ws://`), which the page's security policy allows. The service reaches the app at `APP_INTERNAL_URL` (default `APP_URL`).
- **Presence:**
  - Colours come from the user id, so they're stable.
  - One entry per person.
  - Others' selections are drawn in the grid by our GridCraft (`SheetApp::remote_selections`).
- **Measured (P3-PERF-01):** 20 editors, delivery p95 9 ms (hardening_results.md).
- **Not done in Phase 3:** a Viewer's refused changes are logged by the service, not written to the audit trail (P3-ROLE-01's "audited"). The service has no database access; Phase 4 can add an internal audit route if wanted.

---

## K. Phase 4 decisions

### Decision 59: Phase 4 Owner Answers (Q-05 to Q-07, TQ-10)

**Date:** 2026-11-06
**Status:** Accepted (owner's answers; some details arrive later, marked *pending*)

#### Decision
- **Domain (Q-05):** `sheets.jdfusion.in`.
  - `jdfusion.in` is registered at **GoDaddy**, which manages its DNS. The CRM already runs at `crm.jdfusion.in`, probably on the same Hostinger VPS.
  - *Pending:* the owner gets GoDaddy access, then adds an A record for `sheets` pointing to the VPS.
- **Server (Q-07):** the owner's existing **Hostinger KVM 2** (2 vCPU, 8 GB RAM, 100 GB disk), Ubuntu 24.04 (`srv968172.hstgr.cloud`).
  - It is **shared**: it already runs **n8n** in Docker (Hostinger's n8n template), and probably the CRM.
  - When checked, it was using 61% of memory and 35 GB of disk.
  - Two Hostinger snapshots exist; no Hostinger firewall rules are set.
- **Who runs it:** Claude writes everything: setup and deploy scripts, a step-by-step guide, and the runbook. The owner runs each step on the server, guided in a session.
- **Backups (Q-06):** **Google Drive**, plus a local copy on the VPS.
  - Only the Google Drive copy counts as off-server (P4-BACKUP-01).
  - The local copy is for quick restores.
  - Backups are encrypted before upload.
- **Sign-up emails (Decision 47):** a Google account of the company, for example `sheets@jdfusion.in`, with an app password. The owner sets it up, guided. Until then the fake mailer stays.
- **Alerts:** email to the owner (the address is confirmed when the mailer is set up).
- **Office networks:** *pending.* The owner provides the office and VPN public IPs; they become the bootstrap network rules (`BOOTSTRAP_ALLOWED_CIDRS`).
- **Load test (TQ-10):**
  - about **30 staff** and **20 people editing one workbook at once** (Decision 56);
  - largest workbook today **8,000–10,000 rows**. The load test uses 10,000 rows and a 50 MB workbook (the limit) as the stress case.

#### Consequences for the Phase 4 plan (to settle when planning)
- **Sharing the server:**
  - Ports 80 and 443 are probably already taken by the reverse proxy in front of n8n and the CRM (Traefik in Hostinger's n8n template, or another). So JD Sheets' Caddy cannot simply take them.
  - The plan must first inspect the server (`docker ps`, what listens on 80 and 443) and then either:
    - add `sheets.jdfusion.in` to the existing proxy; or
    - put one shared proxy in front of all three.
  - The IP allowlist then lives in the app's network rules (already the real wall, Decision 46) rather than in Caddy.
- **Memory:** with 61% already used, JD Sheets' containers get memory limits. Rough budget: Postgres 512 MB, app 768 MB, worker 256 MB, Rust service 1 GB (P4-LOAD-03). The load test checks the whole server stays healthy.
- **Hostinger snapshots** are a useful extra before each deploy, but not a replacement for the encrypted off-server backup.

---

### Decision 60: Phase 4 Owner Answers, Part 2 (accounts, office, access)

**Date:** 2026-11-06
**Status:** Accepted (owner's answers; amends Decisions 47 and 59)

#### Decision
- **DNS done:** an A record `sheets.jdfusion.in` → `82.29.165.21` (the Hostinger VPS, the same address as `crm.jdfusion.in`). Checked with `dig` on 2026-11-06.
- **One Google account for everything outside the app:** `JDSheetsByAdam@gmail.com`.
  - It sends the sign-up codes (Gmail SMTP with an app password; the owner has created the app password). This replaces the company account of Decisions 47 and 59: `jdfusion.in` mailboxes are webmail, not Google.
  - It receives the alerts.
  - Its Google Drive holds the encrypted backups.
  - Staff still sign up with `@jdfusion.in` addresses only (Decision 12); only the sender is a Gmail address. Gmail's limit (about 500 messages a day) is far above what 30 staff need.
- **First Super Admin:** `amit@jdfusion.in` (`SEED_SUPER_ADMIN_EMAIL`). The owner types the password on the server.
- **First allowed network:** one office, `103.144.119.117/32` (`BOOTSTRAP_ALLOWED_CIDRS`). The other locations are added by the owner on the Network access page after go-live. Whether this address is static is not known: if it changes, staff are blocked until a Super Admin adds the new one (Super Admins work from anywhere, Decision 57), and `admin:reset-ip-rules` stays the last resort.
- **Server access:** the owner uses Hostinger's browser terminal. Each server step is a short copy-and-paste command; output is pasted back to Claude.
- **Backup passphrase:** chosen by the owner, kept in their password manager and on paper, typed on the server by the owner. Claude never sees it. If it is lost, the backups cannot be opened.
- **Secrets never pass through chat:** the app password, the backup passphrase, the Super Admin password, the GitHub token and the Google Drive authorisation are typed or pasted by the owner on the server.
- TQ-10 is fully answered (Decisions 56 and 59).

---

### Decision 61: Phase 4 Technical Approach

**Date:** 2026-11-06
**Status:** Proposed with the Phase 4 plan (accepted when the owner approves the plan)

#### Decision
- **Images are built by GitHub Actions, not on the server.** The VPS is shared (n8n, the CRM) and has 2 vCPUs; building Rust and the 24 MB editor there would take a long time and starve the other services. CI builds `linux/amd64` images, tags them with the commit, and pushes them to GitHub's container registry (private). The server only pulls. Rolling back means starting the previous tag (P4-DEPLOY-02).
  - Everything else the server needs (compose file, Caddyfile, ops scripts) ships in a small `ops` image of the same tag, so the server needs **one credential**: a GitHub token that can only read packages. No repository clone on the server.
- **Proxy:** decided after the read-only server check (W-401). If another proxy (Traefik from Hostinger's n8n template, or nginx) already owns ports 80 and 443, our Caddy publishes **no public port**: the existing proxy sends `sheets.jdfusion.in` to it and handles HTTPS, and `TRUSTED_PROXY_HOPS` becomes 2. If nothing owns them, Caddy takes 80 and 443 as planned. Either way the edge allowlist stays open (Decision 57) and the app's network rules are the wall.
- **Mail:** a real `smtp` mail driver (Gmail, port 465, TLS) behind the existing `Mailer` interface. Tests use a local SMTP test server, never Gmail (Rule 12).
- **Backups:** a nightly host job (systemd timer, 02:30 IST): a Postgres dump and the workbook files, encrypted with GnuPG (AES-256, the owner's passphrase in a root-only file), kept 7 days on the VPS and 30 days on Google Drive (rclone, limited to files it created). A failure emails an alert. A restore script brings everything back on a fresh machine.
- **Monitoring and alerts:** a host check every 5 minutes: container health (app, worker, collab, db), disk and memory, certificate days left, age of the last good backup. It emails `JDSheetsByAdam@gmail.com` once when a problem starts and once when it clears. Optional: a free outside check (for example healthchecks.io) that emails when the server itself stops reporting.
- **Memory limits** (Decision 59 budget): Postgres 512 MB, app 768 MB, worker 256 MB, Rust service 1 GB. The Rust service unloads idle workbooks first when near its limit, and refuses to open more with a friendly "busy" message rather than being killed (P4-LOAD-03). The load test may adjust these numbers.
- **Logs:** Docker log rotation (10 MB × 5 files per container); logs stay free of secrets and workbook content (P4-OBS-02).
- **Deploys:** `deploy.sh <tag>`: a fresh local backup, then migrations; if they fail, the old version keeps running. Then the new containers start and must turn healthy, otherwise the previous tag is started again. A Hostinger snapshot before risky deploys is recommended, not required.


---

### Decision 62: What the Server Check Found; the Proxy Layout (W-401)

**Date:** 2026-11-06
**Status:** Accepted for the proxy layout; memory and SSH wait for the owner (marked *pending*)

#### Found (read-only check, 2026-11-06)
- Ubuntu 24.04.4, 2 vCPUs, Docker 29.6, Compose 5.3. Disk: 36 GB used, 61 GB free.
- **The server is much busier than Decision 59 assumed:** about 33 containers, about 15 apps. Besides n8n and the CRM (`jd_crm`, maintained from another GitHub account, `kashishkami`), it runs JD Connect with Zulip, Hostinger's Hermes agent and several of the owner's own apps (`mrremind`, `junkyard_gold`, `goalfather` and others), each with its own Postgres.
- **Memory is tight:** 7.8 GB total, 2.8 GB available, and **3.3 GB of the 4 GB swap in use**.
- **Traefik owns ports 80 and 443** (`root-traefik-1`, from Hostinger's n8n template, in `/root`). It reads Docker labels (`exposedbydefault=false`), issues Let's Encrypt certificates with the `mytlschallenge` resolver (HTTP challenge), and redirects HTTP to HTTPS. Its network is `root_default`.
- No firewall: `ufw` is inactive and the Hostinger firewall has no rules. Publicly listening: 22 (SSH), 80, 443, and 32768 (Hostinger's Hermes agent).
- SSH: root login allowed; `PasswordAuthentication` appears as both `yes` and `no` in the config files, so the effective value needs `sshd -T`. Opening Hostinger's browser terminal appears to add a key to `/root/.ssh/authorized_keys`.
- Gmail SMTP (port 465) is reachable.
- The server already pulls from `ghcr.io/doreactnow/…` (`junkyard_gold`), so a registry login for the owner's GitHub account may already exist.

#### Decision
- **Proxy:** Traefik stays the front door. JD Sheets' Caddy publishes **no port**. It joins the `root_default` network with Traefik labels for `Host(\`sheets.jdfusion.in\`)` on `websecure` with the `mytlschallenge` resolver. Traefik handles HTTPS and renewal (P4-DEPLOY-03). Caddy keeps its tested job: internal routes 404, `/collab/*` to the Rust service, compression, the blocked page.
  - **Client address:** Traefik does not trust forwarded headers from the internet (the default), so it sets `X-Forwarded-For` to the real client. Caddy must trust only the Docker network (`trusted_proxies`), so that it keeps that address instead of replacing it with Traefik's. `TRUSTED_PROXY_HOPS="2"`. W-404 tests this, including a spoofed header sent from outside (Rule 5).
  - Only our Caddy joins `root_default`; the database, app, worker and Rust service stay on JD Sheets' own network.
- **JD Sheets' own stack publishes no ports at all.** P4-SEC-04 for JD Sheets is met by that; the server-wide firewall and SSH settings are the owner's choice because they affect every app (see below).
- **Install folder:** `/opt/jdsheets`, like the other apps.
- **Memory (*pending*):** the Decision 61 limits add up to 2.56 GB, almost all that is free. Plan: start with tighter limits (Postgres 384 MB, app 640 MB, worker 192 MB, Rust service 768 MB, about 2 GB at most; normal use well below), and let the load test (W-409) decide. If the server cannot carry 20 live editors without pushing the other apps into swap, the options are a bigger Hostinger plan or a separate small VPS for JD Sheets. That is the owner's call, after the numbers.
- **Server-wide recommendations (*pending*, owner's call):** a Hostinger firewall allowing only 22, 80 and 443 (and 32768 only if the Hermes agent is used); SSH with keys only. Before changing SSH, check that the CRM and JD Connect developer does not log in with a password.

#### Owner's answers (2026-11-06, same day)
- **Only the owner logs in to the server.** The effective SSH settings (`sshd -T`) are `permitrootlogin yes` and `passwordauthentication yes`, so anyone on the internet can try root passwords. In W-410, with the owner: password login off and root by key only (`PasswordAuthentication no`, `PermitRootLogin prohibit-password`, in a drop-in file). Before closing the first terminal, check with `sshd -t` and a **new** browser-terminal tab; Hostinger's emergency console is the fallback. Then the Hostinger firewall: 22, 80 and 443 only.
- **Outside watchdog:** later, not part of go-live.
- A registry login already exists on the server (`/root/.docker/config.json`, 2026-10-29). W-410 first tries pulling a JD Sheets image with it; a new read-only GitHub token is needed only if that fails.

---

### Decision 63: Plan Approved; Second Office; Server-Wide Security After Go-Live

**Date:** 2026-11-06
**Status:** Accepted (owner: "now let's go ahead and deploy this project and make it live")

#### Decision
- **The Phase 4 plan is approved** (Decisions 61, 62). Build it and go live.
- **Two offices at go-live** (`BOOTSTRAP_ALLOWED_CIDRS`): IT Park `103.144.119.117/32` and DB Park `103.163.224.78/32`. Further locations are added on the Network access page.
- **Server-wide security waits until after this project** (owner's choice): SSH password login, root login, and the Hostinger firewall stay as they are for now. They affect every app on the server, not only JD Sheets.
  - JD Sheets itself publishes no ports (Decision 62), so its part of P4-SEC-04 is met. The server-wide part of P4-SEC-04 (SSH keys only, firewall) **moves to a follow-up after go-live**, and `hardening_results.md` records it as an open risk.
  - The snapshot-and-new-tab steps of Decision 62 belonged to that SSH change and move with it. A Hostinger snapshot before the first deploy is still recommended.

---

### Decision 64: Outside the Offices, the Super Admin Gets the Admin Panel Only; No Sheets for Anyone (amends Decision 57)

**Date:** 2026-11-08
**Status:** Accepted (owner: "Go Super Admin only … any other else even the admin should be blocked on outside network"; read as: the Super Admin is never locked out of the admin panel, sheets need an allowed network for everyone)

#### Context
On go-live day the owner, at another location, opened `sheets.jdfusion.in` before signing in and got the blocked page. Signing in at `/sign-in` worked (Decision 57), but nothing pointed there. The owner also wants sheets closed outside the offices for everyone, the Super Admin included.

#### Decision
- **The address works everywhere:** someone not signed in who opens `/` from outside is sent to the sign-in page. Every other page still shows the blocked page to them.
- **Outside the allowed networks, a signed-in Super Admin reaches the admin panel only:**
  - pages: `/admin`, `/admin/approvals`, `/admin/users`, `/admin/network`, `/admin/groups`, `/admin/audit`, `/change-password`, `/forbidden`; `/` goes to `/admin`;
  - API: `/api/admin/approvals`, `/api/admin/users`, `/api/admin/network`, `/api/admin/groups`, `/api/admin/audit`, `/api/auth/*`, `/api/me`, `/api/diagnostics`.
  - Everything about sheets is refused (`NETWORK_BLOCKED`): the workbook list and pages, content, saving, versions, downloads, import, sharing and share targets, the edit lease, the live-editing token, and the admin workbook tools (`/admin/workbooks`, `/api/admin/workbooks/*`).
  - Outside sign-ins and requests stay audited and listed on the Network access page (Decision 57).
- **Everyone else, Admins included, is fully blocked outside**, as before: sign-in is refused with no session kept, and every page and API answers "not available from this network".
- **Switching networks with a sheet open:** every request is checked, so the next save, autosave, lease renewal or live-editing token is refused. Live editing drops with the network change, and reconnecting needs a token that is refused outside. The editor page also checks every 30 seconds. Any `NETWORK_BLOCKED` answer reloads the page, which then shows the blocked page instead of the sheet. Changes typed after the switch are not saved.
- The one list of allowed paths lives in `src/shared/http/outsideAccess.ts` (pages and API), so new routes are blocked outside unless added there.
