// The editor page's live connection (Phase 3, Decisions 10, 22, 56): a WebSocket to the Rust
// service, with everything outside injected so it is tested without a browser.
//   connect → {auth, token} → welcome + the workbook (binary) → the editor opens it and goes live
//   editor change → {command}; server {applied|rejected} → the editor; {presence} → the page
//   tokens are refreshed before they expire; a role change switches the editor's mode at once
//   a dropped connection reconnects and resyncs; if the service can't be reached at all, the page
//   falls back to the one-editor lease (P3-FALLBACK-01).

import { parseInstant } from "@/shared/time";

export type LiveRole = "EDITOR" | "COMMENTER" | "VIEWER";

export interface Person {
  userId: string;
  name: string;
  colour: string;
  role: LiveRole;
  selection: { sheetName: string; range: string } | null;
}

export interface TokenAnswer {
  ok: true;
  token: string;
  url: string;
  expiresAt: string;
  heldBy: string | null;
}

export type TokenResult = TokenAnswer | { ok: false; noAccess: boolean };

export interface LiveState {
  status: "connecting" | "live" | "reconnecting" | "unavailable" | "no-access";
  /** A "save a version now" is on its way. */
  saving: boolean;
  role: LiveRole | null;
  /** The workbook already has the most editors (Decision 56): this person views. */
  full: boolean;
  /** Someone holds the one-editor lease (the live service was down for them). */
  heldBy: string | null;
  people: Person[];
  me: string | null;
}

export interface SocketLike {
  binaryType: string;
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
}

export interface LiveDeps {
  fetchToken(): Promise<TokenResult>;
  openSocket(url: string): SocketLike;
  /** The first workbook: the editor opens it, then goes live at `seq`. */
  onWorkbook(bytes: ArrayBuffer, seq: number, first: boolean): void;
  /** An applied or rejected change for the editor. */
  onServerMessage(message: unknown): void;
  onState(state: LiveState): void;
  timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
  /** Milliseconds now (for token refresh timing). */
  now(): number;
}

const RETRY_MS = [500, 1_000, 2_000, 5_000, 10_000];
/** Refresh this long before the token expires. */
const REFRESH_BEFORE_MS = 60_000;
/** Without a welcome this soon after connecting, the service is treated as unreachable. */
export const FIRST_CONNECT_MS = 6_000;

export interface LiveConnection {
  start(): void;
  stop(): void;
  sendCommand(clientCommandId: string, baseSeq: number, step: unknown): void;
  sendSelection(sheetName: string, range: string): void;
  requestResync(): void;
  /** "Save a version now" (Ctrl/Cmd+S while live). */
  requestSnapshot(): void;
  state(): LiveState;
}

export function createLiveConnection(deps: LiveDeps): LiveConnection {
  let state: LiveState = {
    status: "connecting",
    saving: false,
    role: null,
    full: false,
    heldBy: null,
    people: [],
    me: null,
  };
  let socket: SocketLike | null = null;
  let stopped = false;
  let everWelcomed = false;
  let awaitingBytes: { seq: number } | null = null;
  let attempt = 0;
  let refreshTimer: unknown = null;
  let retryTimer: unknown = null;
  let firstTimer: unknown = null;
  let queue: string[] = [];

  const set = (next: Partial<LiveState>) => {
    state = { ...state, ...next };
    deps.onState(state);
  };

  function send(message: object) {
    const text = JSON.stringify(message);
    if (state.status === "live" && socket) socket.send(text);
    else queue.push(text);
  }

  async function scheduleRefresh(expiresAt: string) {
    if (refreshTimer) deps.timers.clearTimeout(refreshTimer);
    const wait = Math.max(
      5_000,
      parseInstant(expiresAt).getTime() - deps.now() - REFRESH_BEFORE_MS,
    );
    refreshTimer = deps.timers.setTimeout(async () => {
      const fresh = await deps.fetchToken();
      if (stopped) return;
      if (!fresh.ok) {
        if (fresh.noAccess) set({ status: "no-access" });
        socket?.close(1000);
        return;
      }
      socket?.send(JSON.stringify({ type: "refresh", token: fresh.token }));
      void scheduleRefresh(fresh.expiresAt);
    }, wait);
  }

  function reconnectLater() {
    if (stopped) return;
    if (!everWelcomed && attempt >= 1) {
      // Never reached: the page falls back to the one-editor lease (P3-FALLBACK-01).
      set({ status: "unavailable" });
      return;
    }
    set({ status: "reconnecting" });
    const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!;
    attempt += 1;
    retryTimer = deps.timers.setTimeout(() => void connect(), wait);
  }

  function onMessage(data: unknown) {
    if (
      data instanceof ArrayBuffer ||
      (typeof data === "object" && data !== null && "byteLength" in data)
    ) {
      if (!awaitingBytes) return;
      const first = !everWelcomed;
      everWelcomed = true;
      deps.onWorkbook(data as ArrayBuffer, awaitingBytes.seq, first);
      awaitingBytes = null;
      set({ status: "live" });
      for (const text of queue) socket?.send(text);
      queue = [];
      return;
    }
    if (typeof data !== "string") return;
    let message: { type?: string; [key: string]: unknown };
    try {
      message = JSON.parse(data) as typeof message;
    } catch {
      return;
    }
    switch (message.type) {
      case "welcome": {
        if (firstTimer) deps.timers.clearTimeout(firstTimer);
        attempt = 0;
        const you = message.you as { userId: string; role: LiveRole };
        awaitingBytes = { seq: Number(message.seq) };
        set({ role: you.role, me: you.userId, full: message.full === true });
        break;
      }
      case "resync":
        awaitingBytes = { seq: Number(message.seq) };
        break;
      case "applied":
        deps.onServerMessage({
          kind: "applied",
          seq: message.seq,
          clientCommandId: message.clientCommandId ?? null,
          step: message.step,
        });
        break;
      case "rejected":
        deps.onServerMessage({ kind: "rejected", clientCommandId: message.clientCommandId });
        break;
      case "presence":
        set({ people: (message.people as Person[]) ?? [] });
        break;
      case "role":
        set({ role: message.role as LiveRole });
        break;
      case "saved":
        set({ saving: false });
        break;
      case "accessChanged":
        // The server closes next; the reconnect fetches a token with the new role (or none).
        break;
    }
  }

  async function connect() {
    if (stopped) return;
    const token = await deps.fetchToken();
    if (stopped) return;
    if (!token.ok) {
      if (token.noAccess) return set({ status: "no-access" });
      return reconnectLater();
    }
    set({ heldBy: token.heldBy });
    void scheduleRefresh(token.expiresAt);
    const ws = deps.openSocket(token.url);
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: token.token }));
    ws.onmessage = (event) => onMessage(event.data);
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      if (state.status !== "no-access") reconnectLater();
    };
    if (!everWelcomed) {
      firstTimer = deps.timers.setTimeout(() => {
        if (!everWelcomed && socket === ws) {
          socket = null;
          ws.close(1000);
          attempt = Math.max(attempt, 1);
          reconnectLater();
        }
      }, FIRST_CONNECT_MS);
    }
  }

  return {
    start: () => void connect(),
    stop() {
      stopped = true;
      for (const t of [refreshTimer, retryTimer, firstTimer]) if (t) deps.timers.clearTimeout(t);
      socket?.close(1000);
      socket = null;
    },
    sendCommand: (clientCommandId, baseSeq, step) =>
      send({ type: "command", clientCommandId, baseSeq, step }),
    sendSelection: (sheetName, range) =>
      send({ type: "presence", selection: { sheetName, range } }),
    requestResync: () => send({ type: "resync" }),
    requestSnapshot: () => {
      set({ saving: true });
      send({ type: "snapshot" });
    },
    state: () => state,
  };
}
