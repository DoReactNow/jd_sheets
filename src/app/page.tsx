import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SignInForm } from "@/modules/identity/ui/SignInForm";
import { WorkbookList } from "@/modules/workbooks/ui/WorkbookList";
import { currentPrincipal } from "@/shared/http/pageAccess";
import { AppHeader } from "@/shared/ui/AppHeader";

// The main address: the sign-in form until someone signs in, then their sheets (Decision 65).
export default async function HomePage() {
  const principal = await currentPrincipal();
  if (!principal) return <SignInForm next={null} />;
  if (principal.mustChangePassword) redirect("/change-password");
  return (
    <>
      <AppHeader principal={principal} />
      <main className="page">
        <Suspense>
          <WorkbookList />
        </Suspense>
      </main>
    </>
  );
}
