import type { Metadata } from "next";
import { EditorScreen } from "./EditorScreen";
import { requirePageUser } from "@/shared/http/pageAccess";

export const metadata: Metadata = { title: "Workbook" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

export default async function WorkbookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requirePageUser(`/w/${id}`);
  return (
    <EditorScreen
      workbookId={id}
      versionId={one(query.version)}
      adminGrant={one(query.admin)}
      adminTitle={one(query.title)}
    />
  );
}
