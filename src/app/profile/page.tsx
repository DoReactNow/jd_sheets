import type { Metadata } from "next";
import { ProfileForm } from "@/modules/identity/ui/ProfileForm";
import { requirePageUser } from "@/shared/http/pageAccess";
import { AppHeader } from "@/shared/ui/AppHeader";

export const metadata: Metadata = { title: "Your profile" };

const ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MEMBER: "Member",
};

// Decision 66: everyone changes their own name here.
export default async function ProfilePage() {
  const principal = await requirePageUser("/profile");
  return (
    <>
      <AppHeader principal={principal} />
      <ProfileForm
        displayName={principal.displayName}
        email={principal.email}
        roleName={ROLE_NAMES[principal.roleCode] ?? principal.roleCode}
      />
    </>
  );
}
