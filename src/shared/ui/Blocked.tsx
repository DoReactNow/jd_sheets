import { APP_CONFIG } from "@/shared/config/appConfig";
import { SupportContact } from "./SupportContact";

/**
 * Shown instead of any page to someone outside the allowed networks (Decisions 46, 65): a little
 * light-hearted, still clear about what to do next.
 */
export function Blocked() {
  return (
    <main className="message-page blocked" data-testid="blocked-page">
      <div className="blocked-badge" aria-hidden="true">
        <span className="blocked-icon">▦</span>
        <span className="blocked-pin">📍</span>
      </div>
      <p className="blocked-kicker">{APP_CONFIG.product.name} · Out of office</p>
      <h1>Your sheets are homebodies</h1>
      <p>
        They only come out on the office network, and this connection isn&apos;t on the guest list.
        Nothing is wrong with your account, and every sheet is exactly where you left it.
      </p>
      <ul className="blocked-steps">
        <li>
          <strong>At the office?</strong> Switch to the office Wi-Fi or the company VPN, then reload
          this page.
        </li>
        <li>
          <strong>Working from a new place?</strong> Ask your admin to add this network. It takes
          them about a minute.
        </li>
      </ul>
      <div className="blocked-footer">
        <SupportContact />
      </div>
    </main>
  );
}
