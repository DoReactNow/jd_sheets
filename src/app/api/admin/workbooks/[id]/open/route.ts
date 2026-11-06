import {
  workbookSchemas as s,
  workbooksController as c,
} from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "workbooks:administer" },
  input: s.adminOpen,
  handler: c.adminOpen,
});
