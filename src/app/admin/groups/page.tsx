import { GroupsPanel } from "@/modules/identity/ui/GroupsPanel";
import { requirePagePermission } from "@/shared/http/pageAccess";

export default async function Page() {
  await requirePagePermission("/admin/groups", ["groups:manage"]);
  return <GroupsPanel />;
}
