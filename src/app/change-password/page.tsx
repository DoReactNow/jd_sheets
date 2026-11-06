import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/modules/identity/ui/ChangePasswordForm";
import { currentPrincipal } from "@/shared/http/pageAccess";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const principal = await currentPrincipal();
  if (!principal) redirect("/sign-in?next=/change-password");
  return <ChangePasswordForm required={principal.mustChangePassword} />;
}
