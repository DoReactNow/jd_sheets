"use client";

import { useRouter } from "next/navigation";
import { apiRequest } from "@/shared/api/client";

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await apiRequest("/api/auth/sign-out", { method: "POST", body: {} });
    router.replace("/");
    router.refresh();
  }
  return (
    <button type="button" className="btn" onClick={signOut}>
      Sign out
    </button>
  );
}
