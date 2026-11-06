-- CreateEnum
CREATE TYPE "workbook_version_source" AS ENUM ('CREATE', 'SAVE', 'AUTOSAVE', 'IMPORT', 'RESTORE', 'LIVE_SNAPSHOT');

-- CreateTable
CREATE TABLE "workbooks_workbooks" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "owner_id" UUID,
    "current_version_id" UUID,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workbooks_workbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workbooks_versions" (
    "id" UUID NOT NULL,
    "workbook_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "source" "workbook_version_source" NOT NULL,
    "restored_from_id" UUID,
    "name" VARCHAR(100),
    "created_by_id" UUID,
    "contributor_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workbooks_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workbooks_workbooks_current_version_id_key" ON "workbooks_workbooks"("current_version_id");

-- CreateIndex
CREATE INDEX "workbooks_workbooks_owner_id_updated_at_idx" ON "workbooks_workbooks"("owner_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "workbooks_workbooks_updated_at_idx" ON "workbooks_workbooks"("updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "workbooks_versions_storage_key_key" ON "workbooks_versions"("storage_key");

-- CreateIndex
CREATE INDEX "workbooks_versions_workbook_id_created_at_idx" ON "workbooks_versions"("workbook_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "workbooks_versions_workbook_id_number_key" ON "workbooks_versions"("workbook_id", "number");

-- AddForeignKey
ALTER TABLE "workbooks_workbooks" ADD CONSTRAINT "workbooks_workbooks_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "workbooks_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbooks_versions" ADD CONSTRAINT "workbooks_versions_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks_workbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
