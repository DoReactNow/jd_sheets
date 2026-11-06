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

### Decision 8: Changes GridCraft Needs: Proposed Upstream, Patched Locally Meanwhile

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

### Decision 41: Open: Production Domain and Backup Target

**Date:** 2026-11-06
**Status:** Open (needed by Phase 4)
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
- **When the office address changes and nobody inside can reach the page**, the recovery command on the server adds the new range: `npm run admin:reset-ip-rules -- --cidr <range>`. A "Super Admin may sign in from anywhere" exception is **not** built; it is an Open question for the owner (Decision 49).

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

### Decision 49: Open: Super Admin Access From Outside the Allowed Networks

**Date:** 2026-11-06
**Status:** Open (not blocking; decide before go-live)

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
