import { AdminWorkbooksPanel } from "@/modules/workbooks/ui/AdminWorkbooksPanel";
import { requirePagePermission } from "@/shared/http/pageAccess";

export default async function Page() {
  await requirePagePermission("/admin/workbooks", ["workbooks:administer"]);
  return <AdminWorkbooksPanel />;
}
