import { NetworkPanel } from "@/modules/network/ui/NetworkPanel";
import { requirePagePermission } from "@/shared/http/pageAccess";
import { can } from "@/shared/rbac/guard";

export default async function Page() {
  const principal = await requirePagePermission("/admin/network", ["network:view"]);
  return <NetworkPanel canManage={can(principal, "network:manage")} />;
}
