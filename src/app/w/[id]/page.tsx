import type { Metadata } from "next";
import { EditorHost } from "@/modules/editor/ui/EditorHost";
import { requirePageUser } from "@/shared/http/pageAccess";

export const metadata: Metadata = { title: "Workbook" };

export default async function WorkbookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageUser(`/w/${id}`);
  return <EditorHost workbookId={id} />;
}
