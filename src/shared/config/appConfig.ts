// Single source of truth for values that must be identical everywhere (Decision 29,
// project_data.md Section 7). The Rust service keeps copies of the values it needs; a contract
// test checks they match (contracts/app-config.json is generated from this file).
// The support contact is a placeholder until the owner sets it.

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

const MIB = 1024 * 1024;

export const APP_CONFIG = deepFreeze({
  product: {
    name: "JD Sheets",
  },
  company: {
    legalName: "JD Fusion",
    /** The only email domain allowed anywhere (Decision 12). */
    allowedEmailDomain: "jdfusion.in",
  },
  support: {
    /** Shown on error pages. Placeholder text until the owner sets a real contact. */
    contactText: "your JD Fusion admin",
  },
  locale: {
    businessTimezone: "Asia/Kolkata", // IANA name, never a fixed offset (Decision 25)
    locale: "en-IN",
  },
  workbooks: {
    /** Largest workbook accepted, in bytes (Decision 20). */
    maxBytes: 50 * MIB,
    titleMaxLength: 200,
    defaultTitle: "Untitled workbook",
    /** The file extension and media type of stored workbooks. */
    extension: "xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    /** Orphan files (stored but never recorded as a version) are removed after this long. */
    orphanFileGraceHours: 24,
    /** Lists (P2-LIST-*): Recent shows the newest 20 and keeps 50 per person. */
    recentShown: 20,
    recentKept: 50,
    /** Trash (P2-TRASH-*): a trashed workbook is deleted for good after this many days. */
    trashDays: 30,
    /**
     * Version pruning (P2-VER-06): every version for 30 days, then one per day up to a year,
     * then one per month. Named and current versions are always kept.
     */
    keepAllVersionsDays: 30,
    keepDailyVersionsDays: 365,
    /** Import (P2-IMPORT-01): file types accepted, converted to .xlsx. */
    importExtensions: ["xlsx", "xlsb", "ods", "csv", "tsv"],
    versionNameMaxLength: 100,
  },
  /** The edit lease (Decision 21, P2-LEASE-03): lasts 90 s, renewed every 30 s. */
  lease: {
    ttlSeconds: 90,
    renewSeconds: 30,
  },
  /** Autosave (Decision 52, P2-SAVE-01): 5 s after the last change, at most 30 s after the first. */
  autosave: {
    idleMs: 5_000,
    maxWaitMs: 30_000,
    retryMs: 10_000,
  },
  collab: {
    /** Collab token lifetime and accepted clock skew (Decision 10). */
    tokenTtlSeconds: 300,
    tokenLeewaySeconds: 30,
    tokenIssuer: "jd-sheets-app",
    tokenAudience: "jd-sheets-collab",
    /** How long the app waits for the Rust service before reporting it unavailable. */
    requestTimeoutMs: 20_000,
  },
  editor: {
    /** Where the built GridCraft editor is served, on our own origin (Decision 7). */
    basePath: "/editor/",
    /** The prefix of every GridCraft host message. */
    messagePrefix: "gridcraft:",
    /** Messages larger than this are ignored by the bridge (P0-BRIDGE-07). */
    maxMessageBytes: 64 * MIB,
  },
  auth: {
    /** Sessions (Decision 14). */
    sessionIdleHours: 12,
    sessionMaxDays: 7,
    sessionExtendEveryMinutes: 5,
    /** Lockout and sign-in throttling. */
    lockAfterFailures: 5,
    lockMinutes: 15,
    signInAttemptsPerIp: 20,
    signInWindowMinutes: 15,
  },
  otp: {
    /** Sign-up codes (Decision 13). */
    digits: 6,
    validMinutes: 10,
    maxAttempts: 5,
    resendAfterSeconds: 60,
    perEmailPerHour: 5,
    perIpPerHour: 20,
    /** After a correct code, the person has this long to finish sign-up. */
    ticketMinutes: 15,
  },
  mail: {
    /** Connect, greeting and socket timeout for the smtp mailer (P4-MAIL-02). */
    timeoutSeconds: 15,
  },
  network: {
    /** How long the IP rules are cached in each process (Decision 46). */
    cacheSeconds: 5,
    blockedRequestDays: 90,
    /** An open sheet checks it is still on an allowed network this often (Decision 64). */
    editorCheckSeconds: 30,
  },
  ports: {
    app: 47320,
    collab: 47321,
    postgres: 47322,
    fullStack: 47324,
    editorPreview: 47325,
  },
});

export type AppConfig = typeof APP_CONFIG;
