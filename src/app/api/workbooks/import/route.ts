import { workbooksController as c } from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

// Body: the file's bytes; its name in the x-file-name header (P2-IMPORT-*).
export const POST = route({
  access: { permission: "workbooks:create" },
  handler: c.importFile,
});
