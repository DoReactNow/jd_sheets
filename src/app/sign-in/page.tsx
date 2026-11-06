import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/modules/identity/ui/SignInForm";
import { currentPrincipal } from "@/shared/http/pageAccess";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await currentPrincipal()) redirect("/");
  const { next } = await searchParams;
  return <SignInForm next={next ?? null} />;
}
