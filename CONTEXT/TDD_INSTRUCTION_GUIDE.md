# TDD Instruction Guide: How to Write and Execute Work Items for JD Sheets

Every implementation task is written as a **TDD checklist work item** and executed exactly as written. This guide defines the format, the order and the project rules. Read it before planning or building any phase.

**The one rule:** write the failing test first, watch it fail for the right reason, write the smallest code that makes it pass, then refactor with the tests green.

**Test-first is mandatory (Decision 24) for:** the access guard and Super Admin bypass; workbook-role resolution and every workbook route's access; the IP allowlist and client-IP parsing; sign-up, OTP and approval; sessions and lockout; the collab token contract; saving and version conflicts; the edit lease; every background job; the editor bridge protocol; and, in Phase 3, all collaboration logic. Plain CRUD screens may have tests written alongside the code, but the coverage list in Part 4 still applies.

---

## Part 1: The Process

### 1.1 Planning a phase

1. Read `current_state.md` and find the first phase that is not done.
2. Check `decision_log.md` for any **Open** decision that phase needs. If one is open, or anything else needs the owner, ask first (one list of questions, at the start of the phase) and log the answers before planning.
3. Read that phase's section and "Rules for every feature" in `test_scenarios.md`, and settle its open questions.
4. Read the existing code in the area. Plan from what is built, not from the docs alone.
5. Write the work items (Part 2 format) under that phase in `current_state.md`.
6. **Coverage rule:** every scenario of the phase maps to a test in a work item, by ID (for example `P2-SHARE-07`), or is moved to a named later phase with the reason. List moved scenarios in the plan.
7. Show the plan to the owner and wait for approval.
8. Then build the **whole phase in one go**, on one branch and one pull request (Decision 36). Stop only for a blocker that needs the owner.

### 1.2 Work item numbering

Phase N items are `W-N01`, `W-N02`… (Phase 0: `W-001`…). One work item is one user-visible or infrastructure capability.

### 1.3 The execution loop for each work item

```
1. Write the RED tests          -> run them -> confirm they FAIL for the expected reason
2. Write the minimal GREEN code -> run them -> confirm they PASS
3. Refactor                     -> run them -> still PASS
4. Run the verification chain   -> every command green
5. Tick the checkbox in current_state.md
```

If a test passes before the code exists, the test is wrong. Fix the test first.

---

## Part 2: Work Item Template

Copy this for every item. Fill every section; write "None" where something does not apply.

```markdown
### W-XXX: <Short title: the capability>

**Goal:** What can a user (or the system) do after this that it could not before?

**Why now / dependencies:** What must exist. What this unblocks.

**Access:** Permission codes (project_data.md 5.4) and/or workbook capability (5.5). Which roles pass by default. "public" or "internal" must be justified (public routes go in the allow-list).

**Data and time:** Tables and columns. For each date: instant (`timestamptz`) or business date (`date`).

**Errors the user can see:** Each failure and its catalog code.

**Module boundaries:** Owning module; other modules used through `index.ts`; cross-module foreign keys and their `onDelete`.

**Jobs, adapters, GridCraft:** Jobs added (name, trigger, idempotency key). Interfaces used and the `fake`/`local` implementation the tests use. Any bridge message or patch touched. Any Rust endpoint touched.

#### Step 1: Schema and migration
- [ ] Change `prisma/schema.prisma`
- [ ] `npm run db:migrate:dev -- --name <snake_case>`
- [ ] Backward compatible (expand/contract)
- [ ] `npm run db:test:migrate` applies cleanly on an empty test database
- [ ] `npm run db:generate`

#### Step 2: RED tests (write first, watch them fail)
- [ ] Unit: <rules, edge cases, access rule>
- [ ] Integration: <route + real test DB: success, validation, 401, 403/404, conflict, scope>
- [ ] Rust (if any): <unit / integration / property tests>
- [ ] Contract (if any): <fixtures in contracts/>
- [ ] Jobs (if any): <handler rule, run twice = one effect, retry and final failure, clock advanced>
- [ ] Bridge (if any): <message shapes, wrong origin ignored, oversize refused>
- [ ] E2E (only for a critical journey of Decision 24): <flow>
- [ ] Scenario IDs from test_scenarios.md covered by each test
- [ ] Run each level and record the expected failures

#### Step 3: GREEN implementation (bottom up)
- [ ] Types and Zod schemas with friendly messages
- [ ] Repository
- [ ] Service (business rules, workbook-role checks, transactions, audit events)
- [ ] Jobs, if any, exported from index.ts
- [ ] Public API (index.ts)
- [ ] Controller with the access declaration
- [ ] Route adapter
- [ ] Rust changes, if any
- [ ] Frontend through the shared API client and the friendly error mapper

#### Step 4: Verification chain
- [ ] `npm run lint` (ESLint + lint:arch + SSOT scan)
- [ ] `npm run typecheck`
- [ ] `npm run rust:check` (fmt check, clippy -D warnings)
- [ ] `npm run build` · `npm run build:worker` · `npm run rust:build` · `npm run editor:build` (if the editor or patches changed)
- [ ] `npm run test:unit` · `npm run test:integration` · `npm run rust:test` · `npm run test:contract`
- [ ] `npm run test:e2e` (if the item touches a critical journey)
- [ ] Manual check in the browser (UI items): layout at 1440 and 390 px, keyboard use, empty and error states
- [ ] `current_state.md` ticked; decision logged if a design choice was made
```

**Order inside an item is fixed:** schema → RED tests → GREEN code → verification chain.

---

## Part 3: Project Rules (every work item must satisfy these)

### Rule 1: Every route declares its access
`route({ access, handler })` with a registered permission code, `'authenticated'`, `'public'` (allow-listed in `src/shared/rbac/publicRoutes.ts`) or `'internal'` (service token). The route-coverage test scans every `route.ts`.
- RED tests: allowed role succeeds; missing permission → 403 with the generic message; signed out → 401; Super Admin passes through the bypass; internal route without the service token → 401.

### Rule 2: Workbook access goes through the resolver
Workbook routes declare a capability (`read`, `comment`, `edit`, `history`, `share`, `own`). The route wrapper calls `sharing`'s resolver.
- RED tests for every workbook route: each role (Owner, Editor, Commenter, Viewer, none) gets exactly the matrix in `project_data.md` 5.5; **no role → 404, not 403**; a group grant and the company link count; the highest role wins; a removed grant applies on the next request; the Super Admin bypass does **not** open content (Decision 17).
- Lists, counts, search and "recent" never include a workbook the person cannot read.

### Rule 3: Permission codes and internals never reach the user
403 bodies and pages show the catalog message only; assert the body has no permission code, stack, SQL, table, library name or internal ID.

### Rule 4: Friendly errors only
Every failure maps to a catalog code added **before** use. Assert `error.message` equals the catalog text. The Rust service uses the same envelope and codes; a test checks its code list is a subset of the catalog.

### Rule 5: Network rules are always on in their own tests
`NETWORK_ENFORCEMENT` is `off` by default in tests, but every network test turns it on. Client-IP tests cover: no header, one hop, spoofed extra hops, IPv6, IPv4-mapped IPv6, malformed values.

### Rule 6: Time
Instants `timestamptz`, business dates `date`. Only `src/shared/time/` and the Rust `Clock` read the clock. Anything with an expiry (OTP, session, lockout, lease, token, retention, trash) has RED tests with the clock frozen just before and just after the boundary.

### Rule 7: Single source of truth
No literal email domain, company or product name, timezone, size limit, duration, port or date format outside `appConfig.ts`. The SSOT scan stays green. The Rust defaults are checked equal to the TypeScript values.

### Rule 8: Module boundaries
Other modules only through `index.ts`. Repositories write only their own tables. Cross-module foreign keys state `onDelete` (`Restrict` default, `SetNull` with a reason, never `Cascade`). `npm run lint:arch` passes.

### Rule 9: GridCraft is never edited
Nothing inside `vendor/gridcraft` changes. Needed changes go in `patches/gridcraft/` with a header naming the upstream pull request (Decision 8). Only `src/modules/editor/bridge/` knows GridCraft message names; only `services/collab/src/engine/` imports `gridcraft_*` crates. A test enforces both.

### Rule 10: The server is the lock
Anything a role must not do is refused by the server, with a test calling the API directly (not through the UI). Hiding a button or setting the editor mode is never the only protection (Decision 9).

### Rule 11: Saving is safe
Every content write uses `If-Match` with the base version; a stale base gives `CONFLICT` and writes nothing (no version row, no file). A failed write leaves no orphan version row; an orphan file is cleaned by `workbooks.purgeOrphanFiles`. File bytes never go into the database.

### Rule 12: Swappable integrations
Storage, mail and the workbook validator are used only through their interfaces and chosen by env. Only the registry imports an implementation. Every implementation passes its contract suite. Tests use `fake`/`local` only, except the named contract and E2E tests that start the real Rust service.

### Rule 13: Background jobs
`defineJob()` per module, exported from `index.ts`, handler calls the service. Idempotent: run twice → one effect. RED tests for retries, final failure and delayed timing with the clock advanced. Tests use `runPendingJobs()`; never wait on real time. Slow work never runs inside a request.

### Rule 14: Accounts
Domain check (Decision 12) is applied at every place an email enters the system, and by the database constraint; RED tests include look-alikes. No response reveals whether an email has an account. Only `ACTIVE` users get a working principal. The last active Super Admin is protected. An Admin never creates, edits, resets or promotes a Super Admin.

### Rule 15: Rust service rules
- Handlers return the shared envelope with catalog codes; never panic on input (fuzz or property tests for parsers).
- Every request except `/health` needs a valid collab token or the internal service token.
- Time through `Clock`; configuration through `config.rs`; no `localhost` (use `127.0.0.1`).
- Rust integration tests use the test database (`DATABASE_URL` must end in `_test`) and never a real network service outside the test.
- Phase 3: every ordering or rebasing rule has a property test: random command sequences from several clients converge to identical workbooks.

### Rule 16: Migrations
Named, never edited after being applied, backward compatible, `db:migrate:check` green. Prisma owns every table, including `collab_ops`.

### Rule 17: Test data
Tests use `.env.test`, `jdsheets_test` and `seed-test.ts` or helpers. Test users are `*.test@jdfusion.in`. No real names, emails, phone numbers or company spreadsheets in fixtures or golden workbooks. Integration tests never mock Prisma.

### Rule 18: Editor tests
The grid is a canvas. E2E tests use the keyboard and check results through the API or the saved file. Bridge unit tests use a scripted fake iframe that speaks the protocol from `contracts/bridge/`; one E2E per bridge message runs against the real GridCraft build.

---

## Part 4: Test Level Guide

| Level | Files | What | Never |
|:---|:---|:---|:---|
| Unit | `__tests__/*.unit.test.ts(x)` | Services with mocked repositories, guard and resolver decisions, schemas, error mapping, time, components, scans | Database or network |
| Integration | `__tests__/*.int.test.ts` | Route handler with a real `Request` and principal, real test database; status, body, database state | Mock Prisma |
| Rust | `services/collab/src/**` (`#[cfg(test)]`) and `services/collab/tests/*.rs` | Engine adapter, token, IP, validation, (Phase 3) ops and convergence | Real external services |
| Contract | `contracts/**` fixtures; `*.contract.test.ts` and Rust `tests/contract_*.rs` | Token, bridge messages, storage, mail, validator | Drift between the two sides |
| Golden | `golden/*.xlsx` with expected values in `golden/*.json` | Open → save → reopen keeps values, through engine and editor | Real company data |
| E2E | `e2e/*.e2e.ts` | Only the critical journeys of Decision 24, against the built app with fakes and the real editor | Timing sleeps; logic already covered below |

**Always assert the envelope.** Success `{ data }`; failure `{ error: { code, message, requestId } }`, typed with `ApiResponse<T>`.

**Every endpoint covers:** success, validation failure, unauthenticated, forbidden, not found, conflict (if any), and workbook-role scope (if a workbook route).

**Every list screen covers:** sorting in both directions, each filter alone and combined, state kept on Back, empty and error states with friendly text, and no workbook outside the person's access.

---

## Part 5: Worked Example

### W-2xx: Owner shares a workbook with a Viewer

**Goal:** The owner opens Share, adds a colleague as Viewer; the colleague sees it under "Shared with me" and can open but not change it.

**Why now / dependencies:** Needs users (Phase 1), workbooks and versions (Phase 0), the editor mode patch (W-2xx).

**Access:** `'authenticated'` + workbook capability `share`. Only the Owner passes. Super Admin bypass does not pass.

**Data and time:** `sharing_grants` (instant `createdAt`, `updatedAt`); foreign keys to `workbooks_workbooks` (`Restrict`) and `identity_users` (`Restrict`).

**Errors the user can see:** `VALIDATION_FAILED` (unknown role, self-share), `NOT_FOUND` (no access, or the colleague is not active), `CONFLICT` (already shared with that role).

**Module boundaries:** `sharing` owns grants. Reads users through `identity`'s `index.ts`. Writes an audit event through `audit`'s `index.ts`.

**Jobs, adapters, GridCraft:** None for jobs. The editor opens with `mode=view` for Viewers (patch 0001).

#### Step 1: Schema and migration
- [ ] `SharingGrant` model, unique (`workbookId`, `userId`)
- [ ] `npm run db:migrate:dev -- --name add_sharing_grants` · `db:test:migrate` · `db:generate`

#### Step 2: RED tests
- [ ] Unit: highest role wins (owner > editor > commenter > viewer); self-share refused; inactive user refused
- [ ] Integration: Owner `POST /api/workbooks/:id/grants {userId, role: VIEWER}` → 201, row exists, audit event exists (`P2-SHARE-01`, `X-DATA-02`)
- [ ] Integration: an Editor tries to share → 403 with the generic message and no permission code; 403 (not 404) because the Editor can already see the workbook (`P2-SHARE-04`, `X-ACCESS-02`)
- [ ] Integration: a stranger tries → 404 (`X-ACCESS-05`)
- [ ] Integration: the Viewer `PUT /content` → 403 and no new version (`P2-MODE-03`, Rule 10)
- [ ] Integration: the Viewer's "Shared with me" lists it; another user's does not (`P2-SHARE-09`)
- [ ] E2E (journey 4): Viewer opens it, types, nothing changes, no Save available
- [ ] Run each level; record expected failures

#### Step 3: GREEN implementation
- [ ] `sharing.schemas.ts`, `sharing.repository.ts`, `sharing.service.ts` (resolver, add grant, audit), `index.ts`, controller, route, Share dialog UI

#### Step 4: Verification chain
- [ ] Full chain from Part 2; manual check of the Share dialog at 1440 and 390 px

---

## Part 6: Infrastructure Work Items

Setup work (toolchain, editor build, Docker, CI) uses the same format. "RED tests" means a check that proves the capability, for example: a script that fails when a file inside `vendor/gridcraft` is modified; a test that the env loader refuses `DEV_PRINCIPAL=on` in production; a CI step that fails when a patch does not apply. Write the check first, watch it fail, then add the configuration.

---

## Part 7: Common Mistakes (do not do these)

1. Writing code before a failing test exists.
2. Testing only the happy path. 401, 403, 404, validation, conflict and workbook-role tests are required.
3. Mocking the database in integration tests.
4. Using the dev database or the dev seed in tests.
5. Showing a permission code, stack, SQL or library message to a user.
6. `new Date()` or `toLocale*` outside the time module.
7. Typing `jdfusion.in`, a size limit or a duration directly in code.
8. Importing another module's internals.
9. Mock response shapes that differ from `ApiResponse<T>`.
10. Skipping the build or the verification chain.
11. Ticking an item whose chain has not passed.
12. Declaring a UI item done without opening it in the browser.
13. Hard-coding `localhost` or ports.
14. Editing an applied migration.
15. Editing anything in `vendor/gridcraft`, or naming GridCraft messages outside the bridge.
16. Relying on the editor mode or a hidden button instead of a server check.
17. Returning 403 for a workbook the person cannot see (it must be 404).
18. Saving without `If-Match`, or writing a version row before the file is safely stored.
19. A job that is not idempotent, or a test that waits on real time.
20. Calling real SMTP or a real external service in a test.
21. Starting a phase while a decision it needs is still Open.
