import Link from "next/link";
import type { ReactNode } from "react";
import { identityAdmin } from "@/modules/identity";
import { requirePageUser } from "@/shared/http/pageAccess";
import { can } from "@/shared/rbac/guard";
import styles from "@/shared/ui/admin.module.css";
import { AppHeader } from "@/shared/ui/AppHeader";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const principal = await requirePageUser("/admin");
  const pending = can(principal, "users:approve") ? await identityAdmin.countPending() : 0;
  return (
    <>
      <AppHeader principal={principal} />
      <div className={styles.shell}>
        <nav className={styles.side} aria-label="Admin">
          {can(principal, "users:approve") ? (
            <Link href="/admin/approvals">
              Approvals{" "}
              {pending > 0 ? (
                <span className={styles.badge} aria-label={`${pending} waiting`}>
                  {pending}
                </span>
              ) : null}
            </Link>
          ) : null}
          {can(principal, "users:view") ? <Link href="/admin/users">Users</Link> : null}
          {can(principal, "network:view") ? (
            <Link href="/admin/network">Network access</Link>
          ) : null}
          {can(principal, "audit:view") ? <Link href="/admin/audit">Audit trail</Link> : null}
        </nav>
        <main>{children}</main>
      </div>
    </>
  );
}
