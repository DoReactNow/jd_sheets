import { WorkbookList } from "@/modules/workbooks/ui/WorkbookList";
import { AppHeader } from "@/shared/ui/AppHeader";

export default function HomePage() {
  return (
    <>
      <AppHeader />
      <main className="page">
        <WorkbookList />
      </main>
    </>
  );
}
