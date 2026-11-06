import Link from "next/link";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { can } from "@/shared/rbac/guard";
import type { Principal } from "@/shared/rbac/principal";
import styles from "./AppHeader.module.css";
import { SignOutButton } from "./SignOutButton";

const ADMIN_CODES = ["users:approve", "users:view", "network:view", "audit:view"] as const;

/** The bar at the top of every signed-in page (not the editor, which has its own). */
export function AppHeader({ principal }: { principal: Principal }) {
  const isAdmin = ADMIN_CODES.some((code) => can(principal, code));
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          ▦
        </span>
        {APP_CONFIG.product.name}
      </Link>
      <nav className={styles.nav} aria-label="Main">
        <Link href="/">Workbooks</Link>
        {isAdmin ? <Link href="/admin">Admin</Link> : null}
      </nav>
      <div className={styles.user}>
        <span className={styles.name} title={principal.email}>
          {principal.displayName}
        </span>
        <Link href="/change-password" className={styles.link}>
          Password
        </Link>
        <SignOutButton />
      </div>
    </header>
  );
}
