import { SupportContact } from "./SupportContact";

/** Shown instead of any page to an address outside the allowed networks (Decision 46). */
export function Blocked() {
  return (
    <main className="message-page">
      <h1>This isn&apos;t available from this network</h1>
      <p>Connect to the office network or the company VPN, then try again.</p>
      <SupportContact />
    </main>
  );
}
