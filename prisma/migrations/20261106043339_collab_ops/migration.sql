-- CreateTable
CREATE TABLE "collab_ops" (
    "workbook_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "base_version_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_command_id" VARCHAR(80) NOT NULL,
    "command_id" VARCHAR(80) NOT NULL,
    "step" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_ops_pkey" PRIMARY KEY ("workbook_id","seq")
);

-- CreateIndex
CREATE INDEX "collab_ops_workbook_id_base_version_id_seq_idx" ON "collab_ops"("workbook_id", "base_version_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "collab_ops_workbook_id_user_id_client_command_id_key" ON "collab_ops"("workbook_id", "user_id", "client_command_id");

-- AddForeignKey
ALTER TABLE "collab_ops" ADD CONSTRAINT "collab_ops_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks_workbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_ops" ADD CONSTRAINT "collab_ops_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
