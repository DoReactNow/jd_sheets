import { redirect } from "next/navigation";
import { requirePageUser } from "@/shared/http/pageAccess";
import { can } from "@/shared/rbac/guard";

export default async function AdminHome() {
  const principal = await requirePageUser("/admin");
  if (can(principal, "users:approve")) redirect("/admin/approvals");
  if (can(principal, "users:view")) redirect("/admin/users");
  if (can(principal, "network:view")) redirect("/admin/network");
  if (can(principal, "audit:view")) redirect("/admin/audit");
  redirect("/forbidden");
}
