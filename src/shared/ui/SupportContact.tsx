import { APP_CONFIG } from "@/shared/config/appConfig";

/** Who to contact when something keeps going wrong, from APP_CONFIG (the single source of truth). */
export function SupportContact() {
  return <p>If this keeps happening, contact {APP_CONFIG.support.contactText}.</p>;
}
