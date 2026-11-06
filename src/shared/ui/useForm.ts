"use client";

import { useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";

/** Submits a JSON form through the API client; keeps the friendly error and per-field messages. */
export function useApiForm<T>(path: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  async function submit(
    body: unknown,
  ): Promise<{ ok: true; data: T } | { ok: false; error: FriendlyError }> {
    setBusy(true);
    setError(null);
    const result = await apiRequest<T>(path, { method: "POST", body });
    setBusy(false);
    if (!result.ok) setError(result.error);
    return result;
  }

  const fieldError = (field: string) =>
    error?.fieldErrors?.find((f) => f.field === field)?.message ?? null;
  const generalError = error && !error.fieldErrors?.length ? error : null;
  return { busy, error, setError, submit, fieldError, generalError };
}
