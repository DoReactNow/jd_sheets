# Database Schema: JD Sheets

The planned tables, columns, constraints and seeds. Prisma (`prisma/schema.prisma`) is the only source of migrations (Decision 30). When the real schema differs, this file is updated in the same change.

---

## 1. Conventions

- **Table names:** `<module>_<plural>` (for example `identity_users`), mapped with `@@map`. Columns are camelCase in Prisma and mapped to snake_case with `@map`.
- **IDs:** UUID v7 (`@default(uuid(7))`), opaque strings in the API.
- **Time:** instants `timestamptz` (`@db.Timestamptz(3)`), always UTC. No business dates are planned yet; if one is added, it is `date` and travels as `YYYY-MM-DD`.
- **Every table** has `createdAt`; mutable tables also have `updatedAt`.
- **Foreign keys across modules:** `onDelete: Restrict` by default; `SetNull` only with a written reason; never `Cascade` across modules. Within a module, `Cascade` is allowed where stated.
- **Enums** are Postgres enums through Prisma.
- **No file bytes** in any table (Decision 19). Files live in `FileStorage`; rows hold the key, size and hash.
- **Emails** are stored lower-cased and checked by a constraint: `email ~ '^[^@\s]+@jdfusion\.in$'` (the domain comes from the SSOT; the migration is generated from it).

---

## 2. Overview

| Module | Table | Phase |
|:---|:---|:---|
| system | `system_settings` | 0 |
| workbooks | `workbooks_workbooks`, `workbooks_versions` | 0 |
| workbooks | `workbooks_edit_leases`, `workbooks_recent_opens` | 2 |
| identity | `identity_users`, `identity_sessions`, `identity_signup_otps`, `identity_rate_limits`, `rbac_roles`, `rbac_role_permissions` | 1 |
| identity | `identity_groups`, `identity_group_members` | 2 |
| network | `network_ip_rules`, `network_blocked_requests` | 1 |
| audit | `audit_events` | 1 |
| sharing | `sharing_grants`, `sharing_link_opens` | 2 |
| collab | `collab_ops` | 3 |
| (pg-boss) | its own `pgboss` schema | 0 |

```
identity_users ─┬─< identity_sessions
                ├─< identity_group_members >── identity_groups
                ├─< workbooks_workbooks (ownerId)
                ├─< workbooks_versions (createdById)
                ├─< sharing_grants (userId)        sharing_grants >── identity_groups (groupId)
                └─< audit_events (actorId)
rbac_roles ─< rbac_role_permissions ; identity_users >── rbac_roles
workbooks_workbooks ─┬─< workbooks_versions          (currentVersionId → workbooks_versions)
                     ├─1 workbooks_edit_leases
                     ├─< sharing_grants
                     └─< collab_ops
```

---

## 3. Tables

### 3.1 `system_settings` (Phase 0)

| Column | Type | Notes |
|:---|:---|:---|
| `key` | text, PK | |
| `value` | jsonb | |
| `updatedAt` | timestamptz | |

Placeholder that proves the migration chain in Phase 0; later holds editable settings if any are needed.

### 3.2 `workbooks_workbooks` (Phase 0; sharing and trash columns in Phase 2)

| Column | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | |
| `title` | varchar(200) | trimmed, not empty |
| `ownerId` | uuid, FK → `identity_users` (Restrict) | **Phase 0:** nullable, with no FK (no users yet; the development principal owns all). **Phase 1 migration:** backfill to the first Super Admin, then make it required and add the FK (expand/contract). |
| `currentVersionId` | uuid, FK → `workbooks_versions` (Restrict), nullable only during creation | |
| `sizeBytes` | bigint | size of the current version |
| `linkRole` | enum `ShareRole` nullable | company link role (Phase 2); null = off |
| `allowDownloadForReaders` | boolean, default true | Viewers and Commenters may download (Phase 2) |
| `trashedAt` | timestamptz nullable | Phase 2 |
| `trashedById` | uuid nullable, FK → `identity_users` (Restrict) | Phase 2 |
| `createdAt`, `updatedAt` | timestamptz | `updatedAt` moves on every new version |

Indexes: (`ownerId`, `updatedAt` desc), (`trashedAt`), trigram index on `title` for search (Phase 2).

### 3.3 `workbooks_versions` (Phase 0)

| Column | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | used as the `ETag` |
| `workbookId` | uuid, FK → `workbooks_workbooks` (Cascade, same module) | |
| `number` | integer | 1, 2, 3… per workbook; unique (`workbookId`, `number`) |
| `storageKey` | text, unique | `workbooks/<workbookId>/<versionId>.xlsx` |
| `sizeBytes` | bigint | |
| `sha256` | char(64) | of the stored bytes |
| `source` | enum `VersionSource`: `CREATE`, `SAVE`, `AUTOSAVE`, `IMPORT`, `RESTORE`, `LIVE_SNAPSHOT` | |
| `restoredFromId` | uuid nullable, FK → self (SetNull: the source may be pruned; the restore remains valid) | |
| `name` | varchar(100) nullable | named versions are never pruned (Phase 2) |
| `createdById` | uuid nullable, FK → `identity_users` (Restrict) | null in Phase 0; null for live snapshots |
| `contributorIds` | uuid[] | people whose live edits are in a snapshot (Phase 3) |
| `createdAt` | timestamptz | |

Save rule (Decision 20): the file is written first; then, in one transaction, the row is inserted and `currentVersionId` is moved **only if** it still equals the `If-Match` value (`UPDATE … WHERE id = ? AND currentVersionId = ?`; zero rows → `CONFLICT`, transaction rolled back; the stored file becomes an orphan cleaned later by `workbooks.purgeOrphanFiles`).

### 3.4 `workbooks_edit_leases` (Phase 2)

| Column | Type | Notes |
|:---|:---|:---|
| `workbookId` | uuid, PK, FK → `workbooks_workbooks` (Cascade) | one lease per workbook |
| `userId` | uuid, FK → `identity_users` (Restrict) | |
| `sessionId` | uuid, FK → `identity_sessions` (Cascade: a lease dies with its session) | |
| `tabId` | text | random per editor tab |
| `expiresAt` | timestamptz | now + 90 s, renewed every 30 s |
| `createdAt`, `updatedAt` | timestamptz | |

Taking a lease: `INSERT … ON CONFLICT (workbookId) DO UPDATE … WHERE workbooks_edit_leases.expiresAt < now()`, so exactly one taker wins.

### 3.5 `workbooks_recent_opens` (Phase 2)

| Column | Type | Notes |
|:---|:---|:---|
| `userId` | uuid, FK → `identity_users` (Restrict) | PK part |
| `workbookId` | uuid, FK → `workbooks_workbooks` (Cascade) | PK part |
| `openedAt` | timestamptz | |

Only the newest 50 per user are kept.

### 3.6 `identity_users` (Phase 1)

| Column | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | |
| `email` | citext / lower-cased text, unique | domain check constraint (Section 1) |
| `displayName` | varchar(100) | |
| `passwordHash` | text | argon2id |
| `status` | enum `UserStatus`: `PENDING_APPROVAL`, `ACTIVE`, `REJECTED`, `DEACTIVATED` | |
| `roleId` | uuid nullable, FK → `rbac_roles` (Restrict) | required when `ACTIVE` (check constraint) |
| `mustChangePassword` | boolean, default false | |
| `failedSignInCount` | integer, default 0 | |
| `lockedUntil` | timestamptz nullable | |
| `signupSource` | enum: `ADMIN`, `SELF`, `SEED` | |
| `rejectedBefore` | boolean, default false | set when a rejected person signs up again |
| `approvedById`, `rejectedById` | uuid nullable, FK → self (Restrict) | |
| `approvedAt`, `rejectedAt`, `deactivatedAt`, `lastSignInAt`, `passwordChangedAt` | timestamptz nullable | |
| `createdAt`, `updatedAt` | timestamptz | |

A database trigger refuses deactivating or demoting the last active `SUPER_ADMIN`.

### 3.7 `identity_sessions` (Phase 1)

| Column | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | |
| `userId` | uuid, FK → `identity_users` (Cascade, same module) | |
| `tokenHash` | char(64), unique | SHA-256 of the cookie token |
| `ip` | inet | at sign-in |
| `userAgent` | varchar(300) | |
| `expiresAt` | timestamptz | idle expiry, extended at most every 5 minutes |
| `absoluteExpiresAt` | timestamptz | sign-in + 7 days |
| `revokedAt` | timestamptz nullable | |
| `createdAt`, `lastSeenAt` | timestamptz | |

### 3.8 `identity_signup_otps` (Phase 1)

| Column | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | idempotency key of `mail.sendOtp` |
| `email` | text | lower-cased; domain constraint |
| `codeHash` | char(64), nullable | HMAC-SHA-256 with `AUTH_SECRET`; set by the `identity.sendOtp` job (Decision 50) |
| `attempts` | integer, default 0 | max 5 |
| `expiresAt` | timestamptz | + 10 minutes |
| `consumedAt`, `voidedAt` | timestamptz nullable | |
| `requestIp` | inet | |
| `ticketHash` | char(64) nullable | after a correct code: hash of the one-time sign-up ticket for steps 4–5 (valid 15 minutes) |
| `ticketExpiresAt` | timestamptz nullable | |
| `createdAt` | timestamptz | |

Index (`email`, `createdAt` desc). Removed by `identity.cleanupExpired` 24 hours after expiry.

### 3.9 `identity_rate_limits` (Phase 1)

| Column | Type | Notes |
|:---|:---|:---|
| `bucket` | text | for example `signin:ip:<ip>`, `otp:email:<email-hash>` (never the raw email) |
| `windowStart` | timestamptz | |
| `count` | integer | |

PK (`bucket`, `windowStart`). Incremented with an atomic upsert.

### 3.10 `rbac_roles` and `rbac_role_permissions` (Phase 1)

| `rbac_roles` | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | |
| `key` | text, unique | `SUPER_ADMIN`, `ADMIN`, `MEMBER` |
| `name` | varchar(60) | |
| `bypassesAccess` | boolean | true only for `SUPER_ADMIN` |
| `isSystem` | boolean | |

| `rbac_role_permissions` | Type | Notes |
|:---|:---|:---|
| `roleId` | uuid, FK (Cascade, same module) | PK part |
| `permission` | text | PK part; must be a registered code; a trigger refuses reserved codes |
| `source` | enum: `DEFAULT`, `EDITED` | `db:sync-rbac` never removes or overwrites `EDITED` |

### 3.11 `identity_groups` and `identity_group_members` (Phase 2)

| `identity_groups` | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | |
| `name` | varchar(80) | unique case-insensitively |
| `createdById` | uuid, FK → `identity_users` (Restrict) | |
| `createdAt`, `updatedAt` | timestamptz | |

| `identity_group_members` | Type | Notes |
|:---|:---|:---|
| `groupId` | uuid, FK (Cascade) | PK part |
| `userId` | uuid, FK (Cascade) | PK part |
| `addedById` | uuid, FK → `identity_users` (Restrict) | |
| `createdAt` | timestamptz | |

### 3.12 `network_ip_rules` and `network_blocked_requests` (Phase 1)

| `network_ip_rules` | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | |
| `cidr` | cidr, unique | IPv4 or IPv6 |
| `label` | varchar(100) | for example "Head office" |
| `enabled` | boolean, default true | |
| `createdById`, `updatedById` | uuid nullable, FK → `identity_users` (Restrict); null for the bootstrap rules | |
| `createdAt`, `updatedAt` | timestamptz | |

| `network_blocked_requests` | Type | Notes |
|:---|:---|:---|
| `id` | bigint identity, PK | |
| `ip` | inet | |
| `method` | varchar(10) | |
| `path` | varchar(300) | path only, no query string |
| `createdAt` | timestamptz | |

Blocked requests are kept 90 days.

### 3.12a `mail_outbox` (Phase 1, Decision 47)

| Column | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | |
| `to` | text | |
| `subject`, `text` | text | |
| `createdAt` | timestamptz | |

The fake mailer's messages, shared by the app, the worker and the tests. Unused once the SMTP driver is on.

### 3.13 `audit_events` (Phase 1)

| Column | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | |
| `actorId` | uuid nullable, FK → `identity_users` (Restrict) | null for `system` |
| `actorKind` | enum: `USER`, `SYSTEM`, `SERVICE` | |
| `action` | text | registered action names, for example `user.approved`, `workbook.shared`, `workbook.adminOpened` |
| `targetType` | text | `user`, `workbook`, `ipRule`, `group`, … |
| `targetId` | uuid nullable | |
| `ip` | inet nullable | |
| `details` | jsonb | IDs and changed field names only; never passwords, OTPs, tokens or workbook content; reasons typed by admins are allowed |
| `createdAt` | timestamptz | |

A trigger refuses `UPDATE` and `DELETE`. Index (`createdAt` desc), (`actorId`, `createdAt`), (`targetType`, `targetId`).

### 3.14 `sharing_grants` and `sharing_link_opens` (Phase 2)

| `sharing_grants` | Type | Notes |
|:---|:---|:---|
| `id` | uuid v7, PK | |
| `workbookId` | uuid, FK → `workbooks_workbooks` (Cascade, Decision 54) | |
| `userId` | uuid nullable, FK → `identity_users` (Restrict) | exactly one of `userId`, `groupId` (check constraint) |
| `groupId` | uuid nullable, FK → `identity_groups` (Restrict) | |
| `role` | enum `ShareRole`: `EDITOR`, `COMMENTER`, `VIEWER` | `OWNER` is not a grant (Decision 54) |
| `createdById` | uuid, FK → `identity_users` (Restrict) | |
| `createdAt`, `updatedAt` | timestamptz | |

Unique (`workbookId`, `userId`) and (`workbookId`, `groupId`).

| `sharing_link_opens` | Type | Notes |
|:---|:---|:---|
| `workbookId` | uuid, FK (Cascade) | PK part |
| `userId` | uuid, FK (Restrict) | PK part |
| `firstOpenedAt` | timestamptz | so link-only workbooks can appear in "Shared with me" after the first open |

### 3.15 `collab_ops` (Phase 3, written only by the Rust service)

| Column | Type | Notes |
|:---|:---|:---|
| `workbookId` | uuid, FK → `workbooks_workbooks` (Restrict) | PK part |
| `seq` | bigint | PK part; gap-free per workbook |
| `baseVersionId` | uuid, FK → `workbooks_versions` (Restrict) | the version the session was loaded from |
| `userId` | uuid, FK → `identity_users` (Restrict) | |
| `clientCommandId` | uuid | unique per (`workbookId`, `userId`, `clientCommandId`) so retries apply once |
| `commandId` | text | GridCraft command ID, for example `cell.set` |
| `params` | jsonb | as applied (after rebasing); never contains secrets |
| `createdAt` | timestamptz | |

Commands older than the newest snapshot by more than 7 days are pruned.

---

## 4. Seeds

| Seed | Where | Contents |
|:---|:---|:---|
| `db:sync-rbac` | every environment | the three system roles and their default permissions; never removes `EDITED` grants |
| `prisma/seed-test.ts` | test database only | Phase 0: sample workbooks. Phase 1+: `superadmin.test@`, `admin.test@`, `member.test@`, `member2.test@`, `pending.test@`, `rejected.test@`, `deactivated.test@` (all `@jdfusion.in`), passwords from `.env.test`; Phase 2+: a group and shared workbooks covering every role |
| `prisma/seed-dev.ts` | development database | Phase 0: two sample workbooks. Phase 1+: a few development users with known development passwords (refused outside development) |
| `prisma/private/seed.ts` | production (git-ignored) | the first Super Admin from `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD`; the bootstrap IP rules from `BOOTSTRAP_ALLOWED_CIDRS` |
