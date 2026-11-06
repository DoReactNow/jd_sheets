-- CreateEnum
CREATE TYPE "share_role" AS ENUM ('EDITOR', 'COMMENTER', 'VIEWER');

-- AlterTable
ALTER TABLE "workbooks_workbooks" ADD COLUMN     "allow_download_for_readers" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "link_role" "share_role",
ADD COLUMN     "trashed_at" TIMESTAMPTZ(3),
ADD COLUMN     "trashed_by_id" UUID;

-- CreateTable
CREATE TABLE "workbooks_edit_leases" (
    "workbook_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "tab_id" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workbooks_edit_leases_pkey" PRIMARY KEY ("workbook_id")
);

-- CreateTable
CREATE TABLE "workbooks_recent_opens" (
    "user_id" UUID NOT NULL,
    "workbook_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workbooks_recent_opens_pkey" PRIMARY KEY ("user_id","workbook_id")
);

-- CreateTable
CREATE TABLE "identity_groups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "identity_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_group_members" (
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "added_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateTable
CREATE TABLE "sharing_grants" (
    "id" UUID NOT NULL,
    "workbook_id" UUID NOT NULL,
    "user_id" UUID,
    "group_id" UUID,
    "role" "share_role" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sharing_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sharing_link_opens" (
    "workbook_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "first_opened_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sharing_link_opens_pkey" PRIMARY KEY ("workbook_id","user_id")
);

-- CreateIndex
CREATE INDEX "workbooks_recent_opens_user_id_opened_at_idx" ON "workbooks_recent_opens"("user_id", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "identity_group_members_user_id_idx" ON "identity_group_members"("user_id");

-- CreateIndex
CREATE INDEX "sharing_grants_user_id_idx" ON "sharing_grants"("user_id");

-- CreateIndex
CREATE INDEX "sharing_grants_group_id_idx" ON "sharing_grants"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "sharing_grants_workbook_id_user_id_key" ON "sharing_grants"("workbook_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sharing_grants_workbook_id_group_id_key" ON "sharing_grants"("workbook_id", "group_id");

-- CreateIndex
CREATE INDEX "sharing_link_opens_user_id_idx" ON "sharing_link_opens"("user_id");

-- CreateIndex
CREATE INDEX "workbooks_workbooks_trashed_at_idx" ON "workbooks_workbooks"("trashed_at");

-- AddForeignKey
ALTER TABLE "workbooks_workbooks" ADD CONSTRAINT "workbooks_workbooks_trashed_by_id_fkey" FOREIGN KEY ("trashed_by_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbooks_edit_leases" ADD CONSTRAINT "workbooks_edit_leases_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks_workbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbooks_edit_leases" ADD CONSTRAINT "workbooks_edit_leases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbooks_edit_leases" ADD CONSTRAINT "workbooks_edit_leases_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "identity_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbooks_recent_opens" ADD CONSTRAINT "workbooks_recent_opens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbooks_recent_opens" ADD CONSTRAINT "workbooks_recent_opens_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks_workbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_groups" ADD CONSTRAINT "identity_groups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_group_members" ADD CONSTRAINT "identity_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "identity_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_group_members" ADD CONSTRAINT "identity_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_group_members" ADD CONSTRAINT "identity_group_members_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_grants" ADD CONSTRAINT "sharing_grants_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks_workbooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_grants" ADD CONSTRAINT "sharing_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_grants" ADD CONSTRAINT "sharing_grants_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "identity_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_grants" ADD CONSTRAINT "sharing_grants_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_link_opens" ADD CONSTRAINT "sharing_link_opens_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks_workbooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_link_opens" ADD CONSTRAINT "sharing_link_opens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules the database enforces even if the services are bypassed (Phase 2).
-- ---------------------------------------------------------------------------

-- A grant names exactly one person or one group.
ALTER TABLE "sharing_grants" ADD CONSTRAINT "sharing_grants_one_target"
  CHECK (("user_id" IS NULL) <> ("group_id" IS NULL));

-- Group names are unique whatever their case (P2-GROUP-02).
CREATE UNIQUE INDEX "identity_groups_name_ci" ON "identity_groups" (lower("name"));

-- Group names are trimmed and not empty.
ALTER TABLE "identity_groups" ADD CONSTRAINT "identity_groups_name_trimmed"
  CHECK ("name" = btrim("name") AND length("name") > 0);

-- Who trashed a workbook is only set while it is in the Trash.
ALTER TABLE "workbooks_workbooks" ADD CONSTRAINT "workbooks_workbooks_trashed_pair"
  CHECK ("trashed_at" IS NOT NULL OR "trashed_by_id" IS NULL);

-- Title search (P2-LIST-02): case-insensitive substring match uses a trigram index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "workbooks_workbooks_title_trgm" ON "workbooks_workbooks" USING gin (lower("title") gin_trgm_ops);
