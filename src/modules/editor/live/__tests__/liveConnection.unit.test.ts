// The page's live connection (W-309): P3-WS-01, -03, -05, -08, P3-FALLBACK-01, P3-PRES-01, with a
// scripted fake socket.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveConnection,
  FIRST_CONNECT_MS,
  type LiveDeps,
  type LiveState,
  type SocketLike,
  type TokenResult,
} from "../liveConnection";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

class FakeSocket implements SocketLike {
  binaryType = "";
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  server(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  bytes() {
    this.onmessage?.({ data: new Uint8Array([80, 75]).buffer });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

function setup(
  tokens: TokenResult[] = [
    {
      ok: true,
      token: "t1",
      url: "ws://x/collab/wb",
      expiresAt: "2026-11-06T10:05:00Z",
      heldBy: null,
    },
  ],
) {
  const sockets: FakeSocket[] = [];
  const states: LiveState[] = [];
  const workbooks: Array<{ seq: number; first: boolean }> = [];
  const server: unknown[] = [];
  const deps: LiveDeps = {
    fetchToken: vi.fn(async () => (tokens.length > 1 ? tokens.shift()! : tokens[0]!)),
    openSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onWorkbook: (_bytes, seq, first) => workbooks.push({ seq, first }),
    onServerMessage: (m) => server.push(m),
    onState: (s) => states.push(s),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as number),
    },
    now: () => Date.parse("2026-11-06T10:00:00Z"),
  };
  const connection = createLiveConnection(deps);
  return { connection, sockets, states, workbooks, server, deps };
}

async function welcomed(t: ReturnType<typeof setup>, seq = 7, role = "EDITOR") {
  t.connection.start();
  await vi.advanceTimersByTimeAsync(0);
  const socket = t.sockets.at(-1)!;
  socket.open();
  socket.server({ type: "welcome", seq, you: { userId: "u1", role }, full: false });
  socket.bytes();
  return socket;
}

describe("connecting (P3-WS-01)", () => {
  it("authenticates first, then opens the workbook at the server's sequence and goes live", async () => {
    const t = setup();
    const socket = await welcomed(t);
    expect(socket.sent[0]).toEqual({ type: "auth", token: "t1" });
    expect(t.workbooks).toEqual([{ seq: 7, first: true }]);
    expect(t.connection.state()).toMatchObject({ status: "live", role: "EDITOR", me: "u1" });
  });

  it("forwards changes both ways", async () => {
    const t = setup();
    const socket = await welcomed(t);
    t.connection.sendCommand("p-1", 7, { id: "cell.set" });
    expect(socket.sent.at(-1)).toEqual({
      type: "command",
      clientCommandId: "p-1",
      baseSeq: 7,
      step: { id: "cell.set" },
    });
    socket.server({ type: "applied", seq: 8, clientCommandId: "p-1", step: { id: "cell.set" } });
    socket.server({ type: "rejected", clientCommandId: "p-2", reason: "stale" });
    expect(t.server).toEqual([
      { kind: "applied", seq: 8, clientCommandId: "p-1", step: { id: "cell.set" } },
      { kind: "rejected", clientCommandId: "p-2" },
    ]);
  });

  it("shows presence and follows a role change (P3-PRES-01, P3-WS-05)", async () => {
    const t = setup();
    const socket = await welcomed(t);
    socket.server({
      type: "presence",
      people: [{ userId: "u2", name: "Ravi", colour: "#d62728", role: "EDITOR", selection: null }],
    });
    expect(t.connection.state().people[0]).toMatchObject({ name: "Ravi" });
    socket.server({ type: "role", role: "VIEWER" });
    expect(t.connection.state().role).toBe("VIEWER");
  });
});

describe("tokens (P3-WS-03)", () => {
  it("refreshes a minute before the token expires", async () => {
    const t = setup([
      { ok: true, token: "t1", url: "ws://x", expiresAt: "2026-11-06T10:05:00Z", heldBy: null },
      { ok: true, token: "t2", url: "ws://x", expiresAt: "2026-11-06T10:10:00Z", heldBy: null },
    ]);
    const socket = await welcomed(t);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(socket.sent.at(-1)).toEqual({ type: "refresh", token: "t2" });
  });

  it("says when access is gone", async () => {
    const t = setup([{ ok: false, noAccess: true }]);
    t.connection.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.connection.state().status).toBe("no-access");
  });
});

describe("dropping and falling back", () => {
  it("reconnects after a drop and resyncs to the server's workbook (P3-WS-08)", async () => {
    const t = setup();
    const first = await welcomed(t);
    first.drop();
    expect(t.connection.state().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(600);
    const second = t.sockets.at(-1)!;
    expect(second).not.toBe(first);
    second.open();
    second.server({ type: "welcome", seq: 12, you: { userId: "u1", role: "EDITOR" }, full: false });
    second.bytes();
    expect(t.workbooks.at(-1)).toEqual({ seq: 12, first: false });
    expect(t.connection.state().status).toBe("live");
  });

  it("falls back when the live service can't be reached (P3-FALLBACK-01)", async () => {
    const t = setup();
    t.connection.start();
    await vi.advanceTimersByTimeAsync(FIRST_CONNECT_MS + 10);
    expect(t.connection.state().status).toBe("unavailable");
  });

  it("queues changes while reconnecting and sends them once live again", async () => {
    const t = setup();
    const first = await welcomed(t);
    first.drop();
    t.connection.sendCommand("p-9", 7, { id: "x" });
    await vi.advanceTimersByTimeAsync(600);
    const second = t.sockets.at(-1)!;
    second.open();
    second.server({ type: "welcome", seq: 7, you: { userId: "u1", role: "EDITOR" }, full: false });
    second.bytes();
    expect(second.sent.at(-1)).toMatchObject({ type: "command", clientCommandId: "p-9" });
  });
});
