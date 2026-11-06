"use client";

// The editor page with the panels other modules provide (architecture rule 1).
import { EditorHost, type EditorHostProps } from "@/modules/editor/ui/EditorHost";
import { ShareDialog } from "@/modules/sharing/ui/ShareDialog";
import { VersionHistory } from "@/modules/workbooks/ui/VersionHistory";

export function EditorScreen(props: Omit<EditorHostProps, "renderShare" | "renderHistory">) {
  return (
    <EditorHost
      {...props}
      renderShare={(p) => <ShareDialog {...p} />}
      renderHistory={(p) => <VersionHistory {...p} />}
    />
  );
}
