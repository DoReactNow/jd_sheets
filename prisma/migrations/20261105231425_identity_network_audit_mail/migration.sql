-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "signup_source" AS ENUM ('ADMIN', 'SELF', 'SEED');

-- CreateEnum
CREATE TYPE "grant_source" AS ENUM ('DEFAULT', 'EDITED');

-- CreateEnum
CREATE TYPE "audit_actor_kind" AS ENUM ('USER', 'SYSTEM', 'SERVICE');

-- CreateTable
CREATE TABLE "identity_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "user_status" NOT NULL,
    "role_id" UUID,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_sign_in_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "signup_source" "signup_source" NOT NULL,
    "rejected_before" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "rejected_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejected_at" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "last_sign_in_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "identity_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(300),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_signup_otps" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "request_ip" VARCHAR(45),
    "ticket_hash" CHAR(64),
    "ticket_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_signup_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_rate_limits" (
    "bucket" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "identity_rate_limits_pkey" PRIMARY KEY ("bucket","window_start")
);

-- CreateTable
CREATE TABLE "rbac_roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "bypasses_access" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rbac_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rbac_role_permissions" (
    "role_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "source" "grant_source" NOT NULL DEFAULT 'DEFAULT',

    CONSTRAINT "rbac_role_permissions_pkey" PRIMARY KEY ("role_id","permission")
);

-- CreateTable
CREATE TABLE "network_ip_rules" (
    "id" UUID NOT NULL,
    "cidr" INET NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "network_ip_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_blocked_requests" (
    "id" BIGSERIAL NOT NULL,
    "ip" VARCHAR(45) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_blocked_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_kind" "audit_actor_kind" NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "ip" VARCHAR(45),
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_outbox" (
    "id" UUID NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_users_email_key" ON "identity_users"("email");

-- CreateIndex
CREATE INDEX "identity_users_status_created_at_idx" ON "identity_users"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "identity_sessions_token_hash_key" ON "identity_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "identity_sessions_user_id_idx" ON "identity_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_signup_otps_ticket_hash_key" ON "identity_signup_otps"("ticket_hash");

-- CreateIndex
CREATE INDEX "identity_signup_otps_email_created_at_idx" ON "identity_signup_otps"("email", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "rbac_roles_key_key" ON "rbac_roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "network_ip_rules_cidr_key" ON "network_ip_rules"("cidr");

-- CreateIndex
CREATE INDEX "network_blocked_requests_created_at_idx" ON "network_blocked_requests"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_idx" ON "audit_events"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "mail_outbox_to_created_at_idx" ON "mail_outbox"("to", "created_at" DESC);

-- AddForeignKey
-- Phase 0 development workbooks were owned by a principal that is not a user (Decision 48).
UPDATE "workbooks_workbooks" SET "owner_id" = NULL
WHERE "owner_id" IS NOT NULL AND "owner_id" NOT IN (SELECT "id" FROM "identity_users");

ALTER TABLE "workbooks_workbooks" ADD CONSTRAINT "workbooks_workbooks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_users" ADD CONSTRAINT "identity_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "rbac_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_sessions" ADD CONSTRAINT "identity_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "rbac_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules Prisma cannot express (database_schema.md 3.6, 3.10, 3.13).
-- ---------------------------------------------------------------------------

-- Only lower-case @jdfusion.in addresses, everywhere (Decision 12, P1-DOMAIN-08).
ALTER TABLE "identity_users" ADD CONSTRAINT "identity_users_email_domain"
  CHECK ("email" ~ '^[a-z0-9._%+''-]+@jdfusion\.in$');
ALTER TABLE "identity_signup_otps" ADD CONSTRAINT "identity_signup_otps_email_domain"
  CHECK ("email" ~ '^[a-z0-9._%+''-]+@jdfusion\.in$');

-- An active user always has a role.
ALTER TABLE "identity_users" ADD CONSTRAINT "identity_users_active_has_role"
  CHECK ("status" <> 'ACTIVE' OR "role_id" IS NOT NULL);

-- The last active Super Admin cannot be deactivated, demoted or deleted (P1-SA-01).
CREATE FUNCTION identity_protect_last_super_admin() RETURNS trigger AS $$
DECLARE
  super_admin_role uuid;
  remaining integer;
BEGIN
  SELECT "id" INTO super_admin_role FROM "rbac_roles" WHERE "key" = 'SUPER_ADMIN';
  IF super_admin_role IS NULL OR OLD."status" <> 'ACTIVE' OR OLD."role_id" IS DISTINCT FROM super_admin_role THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."status" = 'ACTIVE' AND NEW."role_id" = super_admin_role THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO remaining FROM "identity_users"
    WHERE "status" = 'ACTIVE' AND "role_id" = super_admin_role AND "id" <> OLD."id";
  IF remaining = 0 THEN
    RAISE EXCEPTION 'last active super admin' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER identity_users_last_super_admin
  BEFORE UPDATE OF "status", "role_id" OR DELETE ON "identity_users"
  FOR EACH ROW EXECUTE FUNCTION identity_protect_last_super_admin();

-- Reserved permissions are never granted to any role (P1-SA-03).
CREATE FUNCTION rbac_refuse_reserved_permission() RETURNS trigger AS $$
BEGIN
  IF NEW."permission" IN ('roles:manage', 'users:manage-super-admins') THEN
    RAISE EXCEPTION 'reserved permission' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rbac_role_permissions_reserved
  BEFORE INSERT OR UPDATE ON "rbac_role_permissions"
  FOR EACH ROW EXECUTE FUNCTION rbac_refuse_reserved_permission();

-- The audit trail is append-only (P1-AUDIT-06, X-DATA-03).
CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit events cannot be changed or deleted' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
