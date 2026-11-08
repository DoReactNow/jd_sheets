import { APP_CONFIG } from "@/shared/config/appConfig";

/**
 * Shown instead of any page to someone outside the allowed networks (Decisions 46, 65): light,
 * short, and clear about who to ask.
 */
export function Blocked() {
  const admin = APP_CONFIG.support.contactText;
  return (
    <main className="message-page blocked" data-testid="blocked-page">
      <div className="blocked-badge" aria-hidden="true">
        <span className="blocked-icon">▦</span>
        <span className="blocked-pin">📍</span>
      </div>
      <p className="blocked-kicker">{APP_CONFIG.product.name} · Out of office</p>
      <h1>Your sheets don&apos;t do remote work</h1>
      <p>
        They only open on the office network. Your account is fine, and every sheet is safe right
        where you left it.
      </p>
      <ul className="blocked-steps">
        <li>
          <strong>At the office?</strong> Connect to the office Wi-Fi, then reload this page.
        </li>
        <li>
          <strong>Somewhere new?</strong> Ask {admin} to add this network. It takes about a minute.
        </li>
      </ul>
      <p className="blocked-footer">Still stuck? {admin} can sort it out.</p>
    </main>
  );
}
