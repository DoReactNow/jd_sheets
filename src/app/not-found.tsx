import Link from "next/link";
import { SupportContact } from "@/shared/ui/SupportContact";

export default function NotFound() {
  return (
    <main className="message-page">
      <h1>Page not found</h1>
      <p>We couldn&apos;t find what you were looking for. It may have been moved or deleted.</p>
      <p>
        <Link className="btn btn-primary" href="/">
          Go to your workbooks
        </Link>
      </p>
      <SupportContact />
    </main>
  );
}
