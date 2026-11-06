import {
  workbookSchemas as s,
  workbooksController as c,
} from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "workbooks:administer" },
  input: s.adminList,
  handler: c.adminList,
});
