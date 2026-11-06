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
  ports: {
    app: 47320,
    collab: 47321,
    postgres: 47322,
    fullStack: 47324,
    editorPreview: 47325,
  },
});

export type AppConfig = typeof APP_CONFIG;
