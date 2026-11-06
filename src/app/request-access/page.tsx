import type { Metadata } from "next";
import { RequestAccess } from "@/modules/identity/ui/RequestAccess";

export const metadata: Metadata = { title: "Request access" };

export default function RequestAccessPage() {
  return <RequestAccess />;
}
