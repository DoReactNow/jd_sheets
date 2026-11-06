import { AuditPanel } from "@/modules/audit/ui/AuditPanel";
import { requirePagePermission } from "@/shared/http/pageAccess";

export default async function Page() {
  await requirePagePermission("/admin/audit", ["audit:view"]);
  return <AuditPanel />;
}
