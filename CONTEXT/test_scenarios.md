# Test Scenarios: JD Sheets

The catalogue of normal, failure, race, permission, time and collaboration cases for every phase, in plain language. **It lists what must be true, not test code.** Real tests are written during each work item, before the code they test (`TDD_INSTRUCTION_GUIDE.md`).

## How this file is used

1. **Before a phase is planned**, read its section and "Rules for every feature".
2. **Every scenario of that phase maps to a real test in the phase plan**, by ID, or is moved to a named later phase with the reason. Nothing is dropped silently.
3. **Answer the phase's open questions first.** Where a scenario says "a stated rule", the plan states it (and asks the owner if it is a business rule).
4. **Keep it alive.** A new edge case found while building, or a production bug, is added here in the same pull request. IDs are never renumbered; a retired scenario is marked retired, not deleted.

No list can promise every case. That is why rule 4 exists.

| Section | Scenarios |
|:---|:---|
| Rules for every feature | 59 |
| Phase 0 | 76 |
| Phase 1 | 116 |
| Phase 2 | 82 |
| Phase 3 | 49 |
| Phase 4 | 20 |
| **Total** | **402**, plus 10 open questions (as of 2026-11-06) |

---

## Rules for every feature

These apply to every endpoint, screen, job, table and Rust handler. A plan does not repeat them one by one, but every work item shows how it meets them.

### Access

- **X-ACCESS-01** A signed-out person gets a sign-in response, never data.
- **X-ACCESS-02** A person without the permission is refused with the friendly message; the response contains no permission code.
- **X-ACCESS-03** A person with the permission can do the action.
- **X-ACCESS-04** The Super Admin passes the global permission check, but business rules still apply to them.
- **X-ACCESS-05** A person with no role on a workbook is told "not found", so they cannot learn it exists.
- **X-ACCESS-06** A workbook never appears in lists, counts, search, "recent" or exports of a person who cannot read it.
- **X-ACCESS-07** A permission removed, a share removed or a user deactivated stops working on the very next request.
- **X-ACCESS-08** Changing an ID in a URL or body cannot reach another workbook or user.
- **X-ACCESS-09** A hidden button or the editor mode is never the only protection: calling the API directly is refused too.
- **X-ACCESS-10** A pending, rejected or deactivated user is refused everywhere except their status screen and sign-out.
- **X-ACCESS-11** A request from an IP outside the rules is refused before any other check (Phase 1 onwards).

### Input and validation

- **X-INPUT-01** Missing, empty, wrong-type, too-long and malformed values each give a friendly message on the right field.
- **X-INPUT-02** Unknown extra fields are ignored and never written.
- **X-INPUT-03** Leading and trailing spaces are trimmed where it matters; only spaces counts as empty.
- **X-INPUT-04** Emoji, Hindi and other scripts, apostrophes and very long names are stored and shown correctly.
- **X-INPUT-05** Text that looks like HTML or a script is shown as text and never runs (titles, names, labels, group names).
- **X-INPUT-06** Text that looks like SQL is stored as text and does no harm.
- **X-INPUT-07** A malformed ID in a URL gives "not found", not a server error.
- **X-INPUT-08** Malformed JSON gives a friendly validation message.
- **X-INPUT-09** A very large request body is refused without harming the server.
- **X-INPUT-10** Emails are compared case-insensitively and stored lower-cased.

### Errors and failures

- **X-ERROR-01** Users only see friendly messages: no stack trace, SQL, table name, library name, permission code or internal ID.
- **X-ERROR-02** An unexpected failure shows a friendly message with a reference; the same reference is in the server log.
- **X-ERROR-03** If the database is down, users get a friendly message and health reports it; the app recovers when it returns.
- **X-ERROR-04** If the Rust service is down, saving and opening show a friendly "temporarily unavailable" message and nothing is half-written; the app recovers when it returns.
- **X-ERROR-05** Secrets, passwords, OTPs, tokens and workbook content never appear in logs.
- **X-ERROR-06** The Rust service never crashes on bad input; a panic inside the engine becomes a friendly error for that request only.

### Repeated and simultaneous actions

- **X-REPEAT-01** Double-clicking a submit button creates one record, not two.
- **X-REPEAT-02** Two people changing the same thing at once: one wins cleanly, the other gets a friendly conflict, nothing is corrupted.
- **X-REPEAT-03** Retrying a request after a network drop does not duplicate its effect where duplicates matter (create, share, approve).

### Dates and time

- **X-TIME-01** Every expiry (OTP, session, lockout, lease, token, retention, trash) is tested with the clock just before and just after the boundary.
- **X-TIME-02** Times shown to users are in `Asia/Kolkata` with the standard format, whatever the browser's timezone.
- **X-TIME-03** Stored instants are UTC; the server's own timezone setting changes nothing.
- **X-TIME-04** Our code never changes dates or numbers inside a workbook.

### Lists and tables

- **X-LIST-01** Every sortable column sorts correctly both ways, with a stable tie-breaker.
- **X-LIST-02** Every filter narrows correctly alone and combined.
- **X-LIST-03** Sort, filter, search and page survive navigating away and pressing Back.
- **X-LIST-04** Empty lists and errors show friendly text, not a blank area.
- **X-LIST-05** Pagination never skips or repeats a row when data changes between pages.

### Background jobs

- **X-JOB-01** Running a job twice with the same payload has one effect.
- **X-JOB-02** A failing job retries by its policy, then logs an alert on final failure.
- **X-JOB-03** A delayed or scheduled job runs at the right time when the clock is advanced, and not before.
- **X-JOB-04** A job never runs inside a web request.
- **X-JOB-05** A job touching files and rows never deletes a file still referenced by a row.

### Screens

- **X-SCREEN-01** Works at 1440 px and 390 px wide; the editor page is usable on a laptop and readable on a phone.
- **X-SCREEN-02** Every action is reachable by keyboard, with visible focus.
- **X-SCREEN-03** Loading, empty, error and "no access" states are designed, not blank.
- **X-SCREEN-04** No hard-coded company name, email domain, support contact or product name in components.
- **X-SCREEN-05** Leaving a page with unsaved work asks first.

### Data and audit

- **X-DATA-01** Workbook bytes are never stored in the database.
- **X-DATA-02** Every change to accounts, roles, approvals, network rules, sharing, ownership, deletion and administrator access writes an audit event with actor, target, time and IP, and no secrets or workbook content.
- **X-DATA-03** Audit events cannot be edited or deleted through the app.
- **X-DATA-04** Storage keys contain IDs only, never titles, names or emails.
- **X-DATA-05** Deleting a user is not possible; they are deactivated, and their workbooks keep their history.

### GridCraft and upstream

- **X-UPSTREAM-01** Nothing inside `vendor/gridcraft` is ever modified; the check fails if it is.
- **X-UPSTREAM-02** Every patch applies cleanly to the pinned tag and names its upstream pull request.
- **X-UPSTREAM-03** Every golden workbook opens, saves and reopens with the same values through the engine and the editor, on every GridCraft bump.
- **X-UPSTREAM-04** A GridCraft bump is merged only when every check passes; the weekly job opens an issue otherwise.
- **X-UPSTREAM-05** Only the bridge knows GridCraft message names; only the Rust `engine/` module imports GridCraft crates.

---

## Phase 0: Foundation and walking skeleton

### Environment
- **P0-ENV-01** Tests refuse to run against a database whose name does not end in `_test`.
- **P0-ENV-02** Production refuses `fake` drivers, development placeholders, `DEV_PRINCIPAL=on` and `NETWORK_ENFORCEMENT=off`.
- **P0-ENV-03** A missing or invalid variable stops start-up with a message naming the variable, never its value.
- **P0-ENV-04** The Rust service applies the same test-database and production rules.

### Architecture
- **P0-ARCH-01** A module importing another module's internals fails `lint:arch`.
- **P0-ARCH-02** A literal email domain, port, size limit or company name outside `appConfig.ts` fails the SSOT scan.
- **P0-ARCH-03** A change to any file in `vendor/gridcraft` fails the vendor check.
- **P0-ARCH-04** GridCraft message names outside the bridge, or `gridcraft_*` crates outside `engine/`, fail a test.
- **P0-ARCH-05** A `route.ts` without an access declaration fails the route-coverage test.

### Editor build
- **P0-EDIT-01** *(Retired by Decision 55: GridCraft is our own code, no patches.)* The editor build never writes inside `vendor/gridcraft`.
- **P0-EDIT-02** *(Retired by Decision 55: GridCraft is our own code, no patches.)* A patch that does not apply fails the build and names the patch.
- **P0-EDIT-03** The build records the GridCraft tag, commit and applied patches, shown on the diagnostics page.
- **P0-EDIT-04** The editor is served from our own origin under `/editor/`, with GridCraft's licence files.
- **P0-EDIT-05** With no patches, the built editor behaves exactly like upstream's web build.

### Access foundation
- **P0-ACC-01** The development principal is refused unless `APP_ENV` is `development` or `test`.
- **P0-ACC-02** The guard denies by default.
- **P0-ACC-03** Only the guard reads the Super Admin bypass.
- **P0-ACC-04** An internal route without the service token is refused.

### Errors and time
- **P0-ERR-01** An unexpected error returns `INTERNAL` with a reference that is in the log, and no stack.
- **P0-ERR-02** A validation failure returns `VALIDATION_FAILED` with field errors.
- **P0-ERR-03** Malformed JSON returns `VALIDATION_FAILED`.
- **P0-TIME-01** The time module formats in `Asia/Kolkata`, serialises UTC and is controlled by a fixed clock in tests.

### Rust service and token contract
- **P0-RUST-01** `/health` answers with the envelope.
- **P0-RUST-02** Every Rust error uses the envelope and a catalog code.
- **P0-RUST-03** Rust defaults equal the values in `appConfig.ts`.
- **P0-TOKEN-01** A valid token from the TypeScript issuer is accepted by the Rust verifier.
- **P0-TOKEN-02** An expired token is refused.
- **P0-TOKEN-03** A token expired by less than the 30-second leeway is accepted; by more, refused.
- **P0-TOKEN-04** A wrong audience or issuer is refused.
- **P0-TOKEN-05** A wrong signature is refused.
- **P0-TOKEN-06** A connection from an IP different from the token's `ip` is refused.
- **P0-TOKEN-07** An unknown role is refused.
- **P0-TOKEN-08** A missing claim is refused.

### Validation
- **P0-VAL-01** Every golden workbook opens through the engine with the expected sheets and values.
- **P0-VAL-02** A file that is not a ZIP is refused as unreadable.
- **P0-VAL-03** A ZIP that is not a workbook is refused.
- **P0-VAL-04** A truncated workbook is refused.
- **P0-VAL-05** A file over the size limit is refused before it is fully read.
- **P0-VAL-06** A password-protected workbook is refused with a friendly message.
- **P0-VAL-07** A ZIP bomb is refused without exhausting memory.
- **P0-VAL-08** When the Rust service is down, saving returns "temporarily unavailable" and stores nothing.
- **P0-VAL-09** A panic inside the engine becomes "unreadable" for that file and the service keeps running.

### Storage and jobs
- **P0-STORE-01** The local driver passes the storage contract suite.
- **P0-STORE-02** Keys with `..`, absolute paths or empty segments are refused.
- **P0-JOB-01** A job run twice with the same payload has one effect.
- **P0-JOB-02** A failing job retries, then logs an alert.
- **P0-JOB-03** A delayed job runs only after the clock is advanced past its time.
- **P0-JOB-04** The orphan-file job deletes unreferenced files older than one day and never a referenced one.

### Workbooks core
- **P0-WB-01** Creating a workbook stores version 1, made by the engine, and its rows.
- **P0-WB-02** The list is sorted by last change, newest first.
- **P0-WB-03** Reading content returns the current version's bytes with its version as `ETag`.
- **P0-WB-04** Saving with the current version as `If-Match` creates a new version and moves the pointer.
- **P0-WB-05** Saving with an old version is refused as a conflict; no row and no file are written.
- **P0-WB-06** Saving without `If-Match` is refused with a friendly message.
- **P0-WB-07** If storing the file fails, no version row exists.
- **P0-WB-08** Two saves on the same base at the same moment: exactly one wins.
- **P0-WB-09** Titles: 1–200 characters, trimmed, any script, shown as text.
- **P0-WB-10** An unknown or malformed workbook ID gives "not found".
- **P0-WB-11** An unreadable file is refused and nothing is stored.
- **P0-WB-12** A file over 50 MiB is refused before it is fully read.

### Editor bridge
- **P0-BRIDGE-01** The workbook is sent only after the editor says it is ready.
- **P0-BRIDGE-02** Messages from another origin or another window are ignored.
- **P0-BRIDGE-03** Save sends the bytes with `If-Match`; on success the base moves to the new version.
- **P0-BRIDGE-04** A save conflict offers "Reload latest" or "Save as a copy"; neither loses the person's work without asking.
- **P0-BRIDGE-05** The top bar shows "Unsaved changes" and "Saved" correctly.
- **P0-BRIDGE-06** If the editor fails to start, a friendly message with the support contact is shown.
- **P0-BRIDGE-07** Oversize or malformed messages are ignored.
- **P0-BRIDGE-08** A second save while one is in flight is queued, not lost or duplicated.
- **P0-BRIDGE-09** Leaving with unsaved changes asks first.

### Journeys, Docker, CI
- **P0-E2E-01** Create a workbook, type values and a `SUM` formula, save, reload: the values are there (journey 3).
- **P0-E2E-02** The friendly 404 and 500 pages show (journey 8).
- **P0-DOCKER-01** The full local stack starts and a workbook can be created and saved through Caddy.
- **P0-DOCKER-02** Runtime images have no compilers and run as a non-root user.
- **P0-CI-01** The pipeline runs each step separately, build before tests.
- **P0-CI-02** The weekly upstream job opens a bump pull request when green, and an issue naming the failing step when red.
- **P0-DRILL-01** A fresh clone following only `local_setup.md` gets every check green.

---

## Phase 1: Identity, access and the IP wall

### Email domain
- **P1-DOMAIN-01** `name@jdfusion.in` is accepted, in any letter case, with spaces around it trimmed.
- **P1-DOMAIN-02** `name@gmail.com` is refused with a friendly message naming the allowed domain.
- **P1-DOMAIN-03** `name@sub.jdfusion.in` is refused.
- **P1-DOMAIN-04** `name@jdfusion.in.evil.com` and `name@jdfusion-in.com` are refused.
- **P1-DOMAIN-05** `name@jdfusion.in@evil.com` (several `@`) is refused.
- **P1-DOMAIN-06** Unicode look-alike letters in the domain are refused.
- **P1-DOMAIN-07** The rule applies to sign-up, admin-created accounts, email changes and the seed.
- **P1-DOMAIN-08** The database refuses a row with another domain even if the service is bypassed.

### Sign-up and OTP
- **P1-SIGNUP-01** A new `@jdfusion.in` address requests a code; the fake mailer receives one 6-digit code.
- **P1-SIGNUP-02** The response is the same whether or not the address already has an account.
- **P1-SIGNUP-03** An address that already has an active account gets no code (and the same response).
- **P1-SIGNUP-04** The correct code within 10 minutes lets the person set name and password.
- **P1-SIGNUP-05** After name and password, the account is `PENDING_APPROVAL` and audited.
- **P1-SIGNUP-06** Sign-up cannot skip the OTP step by calling the last step directly.
- **P1-SIGNUP-07** A sign-up ticket from one email cannot complete sign-up for another.
- **P1-SIGNUP-08** The name and password rules apply (shared rule).
- **P1-SIGNUP-09** A rejected person can sign up again; the request returns to pending and shows "rejected before" to admins.
- **P1-SIGNUP-10** A pending person signing up again does not create a second account.
- **P1-OTP-01** A code is valid until 10 minutes and refused just after.
- **P1-OTP-02** A used code cannot be used again.
- **P1-OTP-03** Five wrong tries end the code; the sixth try with the right code is refused.
- **P1-OTP-04** Asking for a new code voids the old one.
- **P1-OTP-05** A resend within 60 seconds is refused with a friendly wait message.
- **P1-OTP-06** More than 5 codes per address per hour, or 20 per IP per hour, are refused.
- **P1-OTP-07** Codes are stored only as hashes.
- **P1-OTP-08** Codes never appear in logs.
- **P1-OTP-09** Mail is sent by the job, not in the request; a mail failure retries and the person can ask again.
- **P1-OTP-10** Codes with spaces or of the wrong length give a friendly message, not a server error.
- **P1-OTP-11** Comparing codes takes the same time whether the code is right or wrong.

### Approval
- **P1-APPROVE-01** A user with `users:approve` sees the pending list, oldest first, with "rejected before" markers.
- **P1-APPROVE-02** Approving with a role makes the account active with that role; audited.
- **P1-APPROVE-03** Rejecting makes it rejected; audited.
- **P1-APPROVE-04** A Member cannot see or act on the queue (403).
- **P1-APPROVE-05** An Admin cannot approve someone as Super Admin.
- **P1-APPROVE-06** Two admins approving and rejecting the same person at once: one wins, the other sees a friendly conflict.
- **P1-APPROVE-07** Approving twice has one effect.
- **P1-APPROVE-08** A pending person who signs in sees only "waiting for approval" and sign-out.
- **P1-APPROVE-09** A rejected person who signs in sees only the friendly "not approved" message.
- **P1-APPROVE-10** A wrong password for a pending or rejected account gives the normal wrong-credentials message (no status leak).
- **P1-APPROVE-11** The navigation shows admins the number of pending requests.

### Sign-in and lockout
- **P1-SIGNIN-01** An active user with the right password is signed in and lands on the home page.
- **P1-SIGNIN-02** A wrong password or unknown email gives one identical message.
- **P1-SIGNIN-03** A deactivated user cannot sign in.
- **P1-SIGNIN-04** The email is matched case-insensitively.
- **P1-SIGNIN-05** No OTP is asked at sign-in.
- **P1-SIGNIN-06** A user with `mustChangePassword` can reach only the change-password screen until they change it.
- **P1-SIGNIN-07** The sign-in page says "Forgot your password? Ask an admin to reset it." and has no reset link.
- **P1-LOCK-01** Five wrong passwords lock the account for 15 minutes; the right password is refused during the lock.
- **P1-LOCK-02** The lock ends just after 15 minutes.
- **P1-LOCK-03** A correct sign-in resets the count.
- **P1-LOCK-04** More than 20 attempts from one IP in 15 minutes are refused.
- **P1-LOCK-05** Lockouts are audited.
- **P1-LOCK-06** Simultaneous wrong attempts cannot get past the limit.

### Sessions and cross-site requests
- **P1-SESS-01** The session cookie is HttpOnly, SameSite=Lax and Secure in production.
- **P1-SESS-02** Only the token's hash is stored.
- **P1-SESS-03** A session ends after 12 hours without activity, not before.
- **P1-SESS-04** A session ends 7 days after sign-in even with activity.
- **P1-SESS-05** Activity extends the session at most once every 5 minutes.
- **P1-SESS-06** Sign-out ends the session; the old cookie no longer works.
- **P1-SESS-07** Deactivation and password reset end all the user's sessions.
- **P1-SESS-08** A role change applies on the next request.
- **P1-SESS-09** A changing request with the session cookie from another origin is refused.
- **P1-SESS-10** A forged or random cookie is treated as signed out.
- **P1-SESS-11** The development principal no longer exists in development after Phase 1.

### Passwords and resets
- **P1-PWD-01** Passwords are stored with argon2id only.
- **P1-PWD-02** 11 characters refused, 12 accepted, 128 accepted, 129 refused.
- **P1-PWD-03** A password equal to the email, or only spaces, is refused.
- **P1-PWD-04** Changing your own password needs the current one; other sessions end.
- **P1-RESET-01** An admin sets a temporary password; the user must change it at next sign-in; all sessions end; audited.
- **P1-RESET-02** A Member cannot reset anyone's password.
- **P1-RESET-03** An Admin cannot reset a Super Admin's password.
- **P1-RESET-04** A Super Admin can reset another Super Admin's password.
- **P1-RESET-05** The recovery command resets a Super Admin's password from the server terminal, never taking the password as an argument, and audits with actor `system`.
- **P1-RESET-06** The recovery command refuses an email that is not an active Super Admin.

### Users and the Super Admin
- **P1-USERS-01** An admin creates a user with a temporary password; the user is active and must change it.
- **P1-USERS-02** Creating a user with an existing email is a friendly conflict.
- **P1-USERS-03** The user list sorts, filters by status and role, and searches by name and email.
- **P1-USERS-04** An admin changes a user's name and role; audited.
- **P1-USERS-05** Deactivate and reactivate; audited; deactivated users keep their workbooks.
- **P1-USERS-06** A user cannot deactivate themselves.
- **P1-USERS-07** Users cannot be deleted (X-DATA-05).
- **P1-SA-01** The last active Super Admin cannot be deactivated or demoted.
- **P1-SA-02** An Admin cannot create, edit, deactivate or promote a Super Admin.
- **P1-SA-03** Reserved permissions cannot be granted to any role (service and database both refuse).
- **P1-SA-04** The Super Admin bypass does not skip business rules.

### Network rules
- **P1-NET-01** A request from an allowed IPv4 address is served.
- **P1-NET-02** A request from a non-allowed IP gets the blocked page (pages) or `NETWORK_BLOCKED` (API), and is logged.
- **P1-NET-03** CIDR ranges work at their edges (first and last address in, the next one out).
- **P1-NET-04** IPv6 rules and addresses work; IPv4-mapped IPv6 is treated as IPv4.
- **P1-NET-05** With one trusted proxy, only the address the proxy added is used; extra spoofed entries are ignored.
- **P1-NET-06** A request without a forwarded header behind the proxy is refused, not treated as allowed.
- **P1-NET-07** Malformed header values are refused, not crashed on.
- **P1-NET-08** The rules page lists, adds, labels, disables and removes rules; changes are audited.
- **P1-NET-09** Saving rules that exclude the admin's own current IP is refused with a friendly message.
- **P1-NET-10** Removing the last rule is refused while enforcement is on.
- **P1-NET-11** Invalid CIDRs (`10.0.0.0/33`, `abc`) give friendly field messages.
- **P1-NET-12** A rule change applies on the next request.
- **P1-NET-13** The sign-in, sign-up and OTP pages are behind the rules too.
- **P1-NET-14** The recovery command replaces the rules with one CIDR and audits it.
- **P1-NET-15** `BOOTSTRAP_ALLOWED_CIDRS` seeds the first rules on an empty table only.
- **P1-NET-16** Caddy's edge allowlist refuses outside addresses before the app sees them (checked in the full-stack test).
- **P1-NET-17** Only `network:manage` can change rules; `network:view` can only look.

### Audit trail
- **P1-AUDIT-01** Every event of X-DATA-02 so far (accounts, approvals, resets, lockouts, sign-in and sign-out, network rules) is written.
- **P1-AUDIT-02** Events contain no password, OTP, token or session value.
- **P1-AUDIT-03** The audit screen filters by actor, action and date range, in `Asia/Kolkata` days.
- **P1-AUDIT-04** A day filter at 23:59 and 00:01 Kolkata time puts events on the right day.
- **P1-AUDIT-05** Only `audit:view` can see it.
- **P1-AUDIT-06** Events cannot be changed or deleted (no route, and a database trigger refuses updates and deletes).

### Seeds and editor identity
- **P1-SEED-01** The test seed creates one user per role plus pending and rejected users, all `*.test@jdfusion.in`.
- **P1-SEED-02** The private seed refuses a non-`@jdfusion.in` Super Admin email and a weak password.
- **P1-SEED-03** `db:sync-rbac` is idempotent and never removes grants.
- **P1-EDITOR-01** The editor's author name is the signed-in user's display name.

### Journeys
- **P1-E2E-01** Sign in as each role; a pending user sees only the waiting screen (journey 1).
- **P1-E2E-02** Sign up with the OTP from the fake mailer, an admin approves, the new user signs in (journey 2).
- **P1-E2E-03** A request from a non-allowed IP sees the blocked page (journey 6).
- **P1-E2E-04** The friendly 403 page (journey 8).

---

## Phase 2: Workbooks complete and sharing

### Groups
- **P2-GROUP-01** An admin creates, renames and deletes groups and adds and removes members; audited.
- **P2-GROUP-02** Group names are unique (case-insensitive) and shown as text.
- **P2-GROUP-03** A group in use by shares cannot be deleted until its shares are removed, or deleting removes them after a clear warning (a stated rule).
- **P2-GROUP-04** Removing a member removes their access through that group on the next request.
- **P2-GROUP-05** Deactivated users stay members but get no access.

### Sharing
- **P2-SHARE-01** The Owner shares with a user as Viewer, Commenter or Editor; audited.
- **P2-SHARE-02** The Owner shares with a group; every active member gets that role.
- **P2-SHARE-03** The Owner changes and removes grants; audited.
- **P2-SHARE-04** An Editor, Commenter or Viewer trying to share gets 403 with the generic message.
- **P2-SHARE-05** A stranger trying to share gets 404.
- **P2-SHARE-06** Sharing with yourself, an unknown user, a pending or deactivated user is refused with a friendly message.
- **P2-SHARE-07** Sharing again with the same user updates the role instead of making a duplicate.
- **P2-SHARE-08** The highest of owner, direct, group and link roles wins.
- **P2-SHARE-09** "Shared with me" lists exactly the workbooks the person can read and are not their own.
- **P2-SHARE-10** A removed share disappears from "Shared with me" and the open editor is refused on its next save or refresh.
- **P2-SHARE-11** The Share dialog search finds active users and groups only.
- **P2-SHARE-12** The Super Admin bypass does not appear as a role and does not open content.
- **P2-LINK-01** The Owner turns on the company link with a role; any active user who opens the link gets that role.
- **P2-LINK-02** Turning the link off removes link-based access on the next request.
- **P2-LINK-03** A link-only user does not see the workbook in their lists until they open the link once (a stated rule).
- **P2-LINK-04** The link is still behind sign-in and network rules.

### Roles in practice (server)
- **P2-ROLE-01** Each role can do exactly what `project_data.md` 5.5 allows, checked on every workbook route.
- **P2-ROLE-02** A Viewer's save is refused and nothing is written.
- **P2-ROLE-03** A Commenter's save that changes only comments is accepted.
- **P2-ROLE-04** A Commenter's save that changes any cell, format, sheet or name is refused and nothing is written.
- **P2-ROLE-05** A Commenter cannot change or delete another person's comment through a save.
- **P2-ROLE-06** A Viewer's and Commenter's export is refused when the Owner turned downloads off.
- **P2-ROLE-07** Version history is visible to Owner, Editor and Commenter, not Viewer.
- **P2-ROLE-08** Only Owner and Editor can restore a version or rename.
- **P2-ROLE-09** Only the Owner can transfer ownership, trash or delete.

### Editor modes (patch 0001)
- **P2-MODE-01** *(Retired by Decision 55: GridCraft is our own code, no patches.)* Patch 0001 applies to the pinned tag and names its upstream pull request.
- **P2-MODE-02** In view mode, typing, pasting, deleting, formatting, sheet changes, undo and Save do nothing, and the ribbon shows editing commands disabled.
- **P2-MODE-03** In view mode the API also refuses any save (X-ACCESS-09).
- **P2-MODE-04** In comment mode only comment commands work.
- **P2-MODE-05** Switching mode while open (`gridcraft:mode`) takes effect at once without losing the view.
- **P2-MODE-06** Edit mode behaves exactly like the unpatched editor.
- **P2-MODE-07** Keyboard shortcuts and menus cannot bypass the mode.
- **P2-MODE-08** The editor opens in the mode of the person's role.

### Edit lease
- **P2-LEASE-01** The first Editor to open a workbook gets the lease.
- **P2-LEASE-02** A second Editor opens in view mode with "Asha is editing" and a Refresh button.
- **P2-LEASE-03** The holder's page renews every 30 seconds; the lease lasts 90 seconds.
- **P2-LEASE-04** When the holder closes the page, the lease is released and the waiting editor can take it.
- **P2-LEASE-05** When the holder's browser disappears, the lease expires just after 90 seconds, not before.
- **P2-LEASE-06** Two Editors opening at the same moment: exactly one gets the lease.
- **P2-LEASE-07** A save without the lease is refused with `WORKBOOK_LOCKED`.
- **P2-LEASE-08** The same person in two tabs: the second tab is told it is open elsewhere (a stated rule).
- **P2-LEASE-09** Losing edit rights while holding the lease ends it on the next renewal.
- **P2-LEASE-10** Viewers and Commenters never take the lease.

### Saving, autosave and versions
- **P2-SAVE-01** Autosave runs after 5 seconds without changes and at most every 30 seconds while editing (stated in SSOT).
- **P2-SAVE-02** Autosave never runs in view mode.
- **P2-SAVE-03** A failed autosave shows a friendly message and retries; work is never silently lost.
- **P2-SAVE-04** Closing with unsaved changes asks first.
- **P2-VER-01** The history lists versions newest first with who and when, in Kolkata time.
- **P2-VER-02** A version can be named; named versions are kept forever.
- **P2-VER-03** Opening an old version shows it in view mode.
- **P2-VER-04** Restoring makes a new version equal to the old one; history is never rewritten; audited.
- **P2-VER-05** Restoring while someone else holds the lease is refused with a friendly message.
- **P2-VER-06** Pruning keeps all versions for 30 days, then one per day to a year, then one per month, and never a named or current one.
- **P2-VER-07** Pruning removes files and rows together and is idempotent.

### Import and export
- **P2-IMPORT-01** `.xlsx`, `.xlsb`, `.ods`, `.csv` and `.tsv` import into a new workbook stored as `.xlsx`.
- **P2-IMPORT-02** Other or broken files are refused with a friendly message.
- **P2-IMPORT-03** The size limit applies to imports.
- **P2-IMPORT-04** The original filename becomes the title (without extension), shown as text.
- **P2-IMPORT-05** A CSV with formulas such as `=HYPERLINK(...)` or `=cmd|...` is imported as written but not executed by our code (GridCraft's own handling applies).
- **P2-EXPORT-01** Download as `.xlsx` returns the current version with a safe filename.
- **P2-EXPORT-02** Export as PDF goes through the editor's export and is downloaded by our page.
- **P2-EXPORT-03** Filenames with slashes, quotes or non-Latin letters download correctly.

### Lists, search and trash
- **P2-LIST-01** My workbooks, Shared with me and Recent sort and filter correctly (X-LIST-*).
- **P2-LIST-02** Search matches titles case-insensitively and only within readable workbooks.
- **P2-LIST-03** Recent lists the last 20 workbooks the person opened, newest first.
- **P2-TRASH-01** The Owner moves a workbook to Trash; it disappears for everyone else at once.
- **P2-TRASH-02** The Owner restores it within 30 days with shares intact.
- **P2-TRASH-03** After 30 days the purge job deletes rows and files; just before 30 days it does not.
- **P2-TRASH-04** Opening a trashed workbook as a non-owner gives "not found".

### Administrator workbook tools
- **P2-ADMINWB-01** A user with `workbooks:administer` sees all workbooks' title, owner, size and last change, not content.
- **P2-ADMINWB-02** They transfer ownership; the old owner becomes an Editor (a stated rule); audited.
- **P2-ADMINWB-03** "Open as administrator" asks for a reason, opens in view mode and writes an audit event every time.
- **P2-ADMINWB-04** A Member cannot reach any of these.
- **P2-ADMINWB-05** Workbooks of a deactivated user are listed for transfer.

### Journeys
- **P2-E2E-01** Share with a Viewer and a Commenter; the Viewer cannot change anything; the Commenter can only comment (journey 4).
- **P2-E2E-02** Restore an older version (journey 5).
- **P2-E2E-03** A second editor sees "is editing" and gets the lease after the first closes.

---

## Phase 3: Live collaboration

### Super Admins from any network (Decision 57)
- **P3-NETSA-01** A Super Admin signs in and works from an address outside the allowed networks; every such sign-in and request is audited and shown on the Network access page.
- **P3-NETSA-02** Anyone else signing in from outside gets the blocked page, and no session is kept.
- **P3-NETSA-03** From outside, every page and API route except sign-in needs a Super Admin session.
- **P3-NETSA-04** Sign-in limits and lockout still apply from outside.

### Connection and token
- **P3-WS-01** A valid token opens the WebSocket; the client receives the current sequence number and presence.
- **P3-WS-02** Expired, forged, wrong-workbook or wrong-IP tokens are refused at connect.
- **P3-WS-03** The client refreshes the token over the connection before it expires; a missed refresh closes the connection with a friendly reconnect.
- **P3-WS-04** The connection is closed when the user is deactivated or their access is removed (access-changed push), within seconds.
- **P3-WS-05** A role change from Editor to Viewer switches the open editor to view mode at once.
- **P3-WS-06** Messages over the size limit or of unknown types close the connection without affecting others.
- **P3-WS-07** Per-connection rate limits stop a flood without affecting other people.
- **P3-WS-08** Network drops reconnect automatically and replay missed commands from the sequence number.

### Patch 0002 and the bridge
- **P3-PATCH-01** *(Retired by Decision 55: GridCraft is our own code, no patches.)*
- **P3-PATCH-02** Every command run locally is sent once with its parameters; commands that only change the person's own view (scroll, selection) are not sent as edits.
- **P3-PATCH-03** Applied commands from others do not echo back.
- **P3-PATCH-04** Applied commands from others do not enter the person's own undo history (a stated rule for undo).
- **P3-PATCH-05** Selection-dependent commands are sent with explicit ranges.
- **P3-PATCH-06** A resync replaces the workbook without losing the person's scroll position where possible.

### Ordering and rebasing
- **P3-ORDER-01** The service gives every accepted command the next sequence number; no gaps, no duplicates.
- **P3-ORDER-02** Every client applies commands in sequence order.
- **P3-ORDER-03** A command sent twice (retry) is applied once (client command ID).
- **P3-REBASE-01** Two people editing different cells at once both keep their edits.
- **P3-REBASE-02** Two people editing the same cell: the later sequence wins for everyone.
- **P3-REBASE-03** A cell edit below rows inserted by someone else lands on the shifted cell, or is rejected and resynced (a stated rule per command type).
- **P3-REBASE-04** A formula referring to cells moved by someone else is adjusted the same way for everyone.
- **P3-REBASE-05** Editing a sheet that someone else just deleted is rejected with a friendly message and resync.
- **P3-REBASE-06** A rejected command never leaves the person's editor different from the server.

### Convergence (property tests)
- **P3-CONV-01** Random command sequences from 2–8 simulated clients, with random delays and reconnects, end with byte-identical workbook values on every client and the server.
- **P3-CONV-02** Replaying `collab_ops` on the last snapshot gives the same workbook as the live session.
- **P3-CONV-03** A golden workbook edited live and saved still passes its golden checks for untouched cells.

### Roles per command
- **P3-ROLE-01** A Viewer's commands are all refused and audited as attempts.
- **P3-ROLE-02** A Commenter's comment commands are accepted; every other command is refused.
- **P3-ROLE-03** A Commenter cannot edit or delete another person's comment.
- **P3-ROLE-04** A comment's author is always the token's user, whatever the command says.
- **P3-ROLE-05** Commands that would save, export to the server or change protection follow the Owner/Editor rules.

### Presence
- **P3-PRES-01** Everyone in the workbook sees who else is in it, with a stable colour per person.
- **P3-PRES-02** Selected cells of others are shown and update live.
- **P3-PRES-03** A person who leaves or drops disappears within 30 seconds.
- **P3-PRES-04** The same person in two tabs appears once.
- **P3-PRES-05** Names in presence come from the token, never from the client.

### Snapshots, recovery and fallback
- **P3-SNAP-01** Every 10 minutes while people are editing, and when the last person leaves, a snapshot becomes a new version through the app (Decision 56).
- **P3-SNAP-02** A snapshot failure retries and never loses commands.
- **P3-SNAP-03** Snapshots made by the service show "Live edits" as the author with the people involved (a stated rule).
- **P3-RECOV-01** After a service restart, the workbook loads from the last version plus later commands, with nothing lost.
- **P3-RECOV-02** Clients reconnect after a restart and continue.
- **P3-RECOV-03** Commands already in `collab_ops` older than the latest snapshot are pruned safely.
- **P3-FALLBACK-01** If the service is unreachable, the editor falls back to the Phase 2 edit lease with a friendly notice.
- **P3-FALLBACK-02** The edit lease and live sessions never both allow editing the same workbook.
- **P3-RESTORE-01** Restoring a version during a live session resyncs every client to the restored content.

### Performance and limits
- **P3-PERF-01** A command reaches other clients within 300 ms at the 95th percentile on the local network with 20 editors (Decision 56).
- **P3-PERF-02** An idle workbook session is unloaded from memory after 10 minutes without connections.
- **P3-PERF-03** At most 25 editors per workbook (Decision 56); the next one opens in view mode with a friendly message.

### Journey
- **P3-E2E-01** Two browsers edit the same workbook live and both end with the same values (journey 7).

---

## Phase 4: Hardening and go-live

- **P4-LOAD-01** The load test with the agreed number of people and open workbooks meets the latency and memory targets; results in `hardening_results.md`.
- **P4-LOAD-02** A 50 MiB workbook opens, edits and saves within the stated times.
- **P4-LOAD-03** The Rust service stays under its memory limit; when near it, it unloads idle sessions first.
- **P4-SEC-01** Security headers (CSP with nonces, HSTS, frame rules allowing only our own iframe, no-sniff, referrer policy) are present.
- **P4-SEC-02** `npm audit` and `cargo audit` have no high findings, or each is logged with a reason.
- **P4-SEC-03** `/api/internal/*` and the service's internal endpoints are unreachable from outside.
- **P4-SEC-04** Only ports 80 and 443 are open publicly; SSH only from the owner's IPs, keys only.
- **P4-SEC-05** Secrets exist only in `.env.production` on the server, readable by root and the app user only.
- **P4-BACKUP-01** Nightly encrypted backups of the database and workbook files reach the off-server target.
- **P4-BACKUP-02** A restore drill on a fresh machine brings back users, shares and workbooks; time recorded.
- **P4-BACKUP-03** A failed backup raises an alert.
- **P4-DEPLOY-01** Deploying runs migrations first, then starts the new version; a failed migration leaves the old version running.
- **P4-DEPLOY-02** Rolling back to the previous image works and is written in the runbook.
- **P4-DEPLOY-03** HTTPS certificates renew automatically.
- **P4-OBS-01** Health of app, worker, collab and database is monitored with alerts.
- **P4-OBS-02** Logs are structured, rotated and free of secrets and workbook content.
- **P4-OBS-03** Blocked-network counts and failed sign-ins are visible to admins.
- **P4-DRILL-01** Service-down drills: database, collab service, worker, disk full; each recovers and is written in the runbook.
- **P4-DRILL-02** The Super Admin and IP-rule recovery commands work on the production server.
- **P4-MAIL-01** The `smtp` mail driver passes the mailer contract suite against a local SMTP test server (never Gmail in tests).
- **P4-MAIL-02** A wrong app password or an unreachable mail server makes the `identity.sendOtp` job retry and then fail, with log lines that contain no password and no code.
- **P4-MAIL-03** Production refuses `MAIL_DRIVER=fake` and refuses to start when an SMTP setting is missing.
- **P4-OUT-01** Outside the allowed networks, a signed-in Super Admin reaches every admin-panel API (approvals, users, network rules including adding one, groups, audit, diagnostics, me) (Decision 64).
- **P4-OUT-02** Outside, the Super Admin is refused every sheet API with `NETWORK_BLOCKED`: list, create, import, read, content, save, versions, download, sharing, share targets, lease, live-editing token, admin workbook tools.
- **P4-OUT-03** Outside, an Admin (not Super Admin) is refused sign-in and, with a session from the office, every page and API.
- **P4-OUT-04** A Super Admin outside adds their own address as a rule; from then on the same address is inside and sheets open.
- **P4-OUT-05** Pages outside: not signed in, `/` goes to sign-in and other pages show the blocked page; Super Admin: admin pages show, `/` goes to `/admin`, sheet pages and `/admin/workbooks` show the blocked page.
- **P4-OUT-06** In the browser, any `NETWORK_BLOCKED` answer reloads the page (so the blocked page replaces an open sheet), at most once; the editor checks the network every 30 seconds.
- **P4-ACCEPT-01** The owner's acceptance walk-through on the real domain from an office network, and a refusal from a non-office network.

---

## Open questions

| ID | Question | Phase |
|:---|:---|:---|
| TQ-01 | Group deletion when shares use it: refuse, or remove its shares after a warning (P2-GROUP-03)? | 2 (answered: Decision 52) |
| TQ-02 | Should link-only access show in "Shared with me" before the first open (P2-LINK-03)? | 2 (answered: Decision 52) |
| TQ-03 | After an ownership transfer, does the old owner keep Editor access (P2-ADMINWB-02)? | 2 (answered: Decision 52) |
| TQ-04 | Same person, two tabs, one lease: block the second tab or move the lease (P2-LEASE-08)? | 2 (answered: Decision 52) |
| TQ-05 | Autosave timings (P2-SAVE-01) | 2 (answered: Decision 52) |
| TQ-06 | Undo with live co-editing: own changes only (recommended), or everything (P3-PATCH-04)? | 3 (answered: Decision 56) |
| TQ-07 | Rebasing rule per command type (P3-REBASE-03) | 3 (answered: Decision 56) |
| TQ-08 | Maximum editors per workbook (P3-PERF-03) | 3 (answered: Decision 56) |
| TQ-09 | How live snapshots are labelled in history (P3-SNAP-03) | 3 (answered: Decision 56) |
| TQ-10 | Load-test targets: number of staff, peak concurrent editors, largest expected workbook (P4-LOAD-01) | 4 (answered: Decisions 56, 59, 60) |
