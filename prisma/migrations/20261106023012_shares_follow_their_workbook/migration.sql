-- DropForeignKey
ALTER TABLE "sharing_grants" DROP CONSTRAINT "sharing_grants_workbook_id_fkey";

-- DropForeignKey
ALTER TABLE "sharing_link_opens" DROP CONSTRAINT "sharing_link_opens_workbook_id_fkey";

-- AddForeignKey
ALTER TABLE "sharing_grants" ADD CONSTRAINT "sharing_grants_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks_workbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_link_opens" ADD CONSTRAINT "sharing_link_opens_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks_workbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
