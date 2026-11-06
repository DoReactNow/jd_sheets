import { UsersPanel } from "@/modules/identity/ui/UsersPanel";
import { requirePagePermission } from "@/shared/http/pageAccess";
import { can } from "@/shared/rbac/guard";

export default async function Page() {
  const principal = await requirePagePermission("/admin/users", ["users:view"]);
  return (
    <UsersPanel
      me={principal.userId}
      can={{
        create: can(principal, "users:create"),
        edit: can(principal, "users:edit"),
        deactivate: can(principal, "users:deactivate"),
        reset: can(principal, "users:reset-password"),
        superAdmins: can(principal, "users:manage-super-admins"),
      }}
    />
  );
}
