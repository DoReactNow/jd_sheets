import Link from "next/link";
import { SupportContact } from "@/shared/ui/SupportContact";

export default function ForbiddenPage() {
  return (
    <main className="message-page">
      <h1>You don&apos;t have access to this page</h1>
      <p>If you think you should, ask an admin.</p>
      <p>
        <Link className="btn btn-primary" href="/">
          Go to your workbooks
        </Link>
      </p>
      <SupportContact />
    </main>
  );
}
