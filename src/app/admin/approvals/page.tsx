import { ApprovalsPanel } from "@/modules/identity/ui/ApprovalsPanel";
import { requirePagePermission } from "@/shared/http/pageAccess";
import { can } from "@/shared/rbac/guard";

export default async function Page() {
  const principal = await requirePagePermission("/admin/approvals", ["users:approve"]);
  return <ApprovalsPanel canApproveSuperAdmin={can(principal, "users:manage-super-admins")} />;
}
