// The only source of user-facing error messages (Decision 26, project_data.md Section 8).
// A new failure situation gets a catalog entry here BEFORE it is used. The Rust service uses a
// subset of these codes (contracts/error-codes.json, checked on both sides).
import { APP_CONFIG } from "@/shared/config/appConfig";

const MAX_WORKBOOK_MB = Math.round(APP_CONFIG.workbooks.maxBytes / (1024 * 1024));

export const ERROR_CATALOG = {
  VALIDATION_FAILED: {
    status: 400,
    message: "Some details need fixing. Please check the highlighted fields.",
  },
  UNAUTHENTICATED: { status: 401, message: "Please sign in to continue." },
  FORBIDDEN: { status: 403, message: "You don't have access to do this." },
  NOT_FOUND: { status: 404, message: "We couldn't find what you were looking for." },
  CONFLICT: {
    status: 409,
    message: "This was changed by someone else. Please refresh and try again.",
  },
  WORKBOOK_CHANGED: {
    status: 409,
    message:
      "This workbook was changed since you opened it. Reload the latest version or save yours as a copy.",
  },
  REQUEST_TOO_LARGE: { status: 413, message: "That request is too large." },
  WORKBOOK_TOO_LARGE: {
    status: 413,
    message: `This workbook is too large. Workbooks can be up to ${MAX_WORKBOOK_MB} MB.`,
  },
  WORKBOOK_UNREADABLE: {
    status: 422,
    message:
      "We couldn't read this file as a workbook. It may be damaged, password-protected or in another format.",
  },
  RATE_LIMITED: { status: 429, message: "Too many attempts. Please wait a moment and try again." },
  INTERNAL: { status: 500, message: "Something went wrong on our side. Please try again." },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: "This is temporarily unavailable. Please try again in a moment.",
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CATALOG, value);
}

/** Shown for a form field whose schema did not define its own friendly message. */
export const GENERIC_FIELD_MESSAGE = "Please check this field.";

/** Shown by the browser client when the request never reached the server. */
export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach the server. Please check your connection and try again.";
