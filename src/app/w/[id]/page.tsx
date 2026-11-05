import type { Metadata } from "next";
import { EditorHost } from "@/modules/editor/ui/EditorHost";

export const metadata: Metadata = { title: "Workbook" };

export default async function WorkbookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorHost workbookId={id} />;
}
