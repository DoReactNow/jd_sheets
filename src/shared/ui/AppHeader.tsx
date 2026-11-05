import Link from "next/link";
import { APP_CONFIG } from "@/shared/config/appConfig";
import styles from "./AppHeader.module.css";

/** The bar at the top of every signed-in page (not the editor, which has its own). */
export function AppHeader() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          ▦
        </span>
        {APP_CONFIG.product.name}
      </Link>
    </header>
  );
}
