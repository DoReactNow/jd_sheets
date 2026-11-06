import { Suspense } from "react";
import { WorkbookList } from "@/modules/workbooks/ui/WorkbookList";
import { requirePageUser } from "@/shared/http/pageAccess";
import { AppHeader } from "@/shared/ui/AppHeader";

export default async function HomePage() {
  const principal = await requirePageUser("/");
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
