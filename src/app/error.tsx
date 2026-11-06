"use client";

import { ErrorPageContent } from "@/shared/ui/ErrorPageContent";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorPageContent error={error} retry={reset} />;
}
