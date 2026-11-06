"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";

/** Loads JSON from the API and reloads on demand. */
export function useApiData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const reload = useCallback(async () => {
    const result = await apiRequest<T>(path);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(result.error);
  }, [path]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);
  return { data, error, reload };
}

/** Sends a change and returns the friendly error, if any. */
export async function apiSend<T = unknown>(path: string, method: string, body: unknown = {}) {
  return apiRequest<T>(path, { method, body });
}
