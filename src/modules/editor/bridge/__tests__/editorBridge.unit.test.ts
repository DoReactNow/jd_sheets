// P0-BRIDGE-01..09 with a scripted fake editor window (no browser needed).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createEditorBridge, type BridgeDeps, type BridgeState, type SaveOutcome } from "../editorBridge";
import { MESSAGE, parseIncoming } from "../messages";

const ORIGIN = "http://127.0.0.1:47320";

function setup(overrides: Partial<BridgeDeps> = {}) {
  let listener: ((event: MessageEvent) => void) | null = null;
  const editor = { postMessage: vi.fn() };
  const states: BridgeState[] = [];
  const saves: Array<{ bytes: Uint8Array; base: string; resolve: (o: SaveOutcome) => void }> = [];
  const deps: BridgeDeps = {
    host: {
      addEventListener: (_type: string, fn: unknown) => {
        listener = fn as (event: MessageEvent) => void;
      },
      removeEventListener: () => {
        listener = null;
      },
    } as BridgeDeps["host"],
    editor: () => editor as unknown as Window,
    origin: ORIGIN,
    load: async () => ({
      ok: true,
      workbook: { name: "Budget.xlsx", bytes: new Uint8Array([80, 75, 1]).buffer, versionId: "v1" },
    }),
    save: (bytes, base) => new Promise((resolve) => saves.push({ bytes, base, resolve })),
    download: vi.fn(),
    onChange: (state) => states.push(state),
    ...overrides,
  };
  const bridge = createEditorBridge(deps);
  bridge.start();
  const send = (data: unknown, from: { origin?: string; source?: unknown } = {}) =>
    listener?.({
      data,
      origin: from.origin ?? ORIGIN,
      source: "source" in from ? from.source : editor,
    } as MessageEvent);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { bridge, editor, states, saves, send, flush, deps };
}

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe("opening (P0-BRIDGE-01)", () => {
  it("sends the workbook only after the editor says it is ready, transferring the buffer", async () => {
    const t = setup();
    await t.flush();
    expect(t.editor.postMessage).not.toHaveBeenCalled();
    t.send({ type: MESSAGE.ready, version: "0.16.1" });
    await t.flush();
    expect(t.editor.postMessage).toHaveBeenCalledTimes(1);
    const [message, origin, transfer] = t.editor.postMessage.mock.calls[0];
    expect(message).toMatchObject({ type: MESSAGE.open, name: "Budget.xlsx" });
    expect(origin).toBe(ORIGIN);
    expect(transfer).toEqual([message.bytes]);
    expect(t.bridge.state()).toMatchObject({ status: "saved", baseVersionId: "v1" });
  });

  it("does not open a second copy when the editor says ready twice", async () => {
    const t = setup();
    t.send({ type: MESSAGE.ready });
    await t.flush();
    t.send({ type: MESSAGE.ready });
    await t.flush();
    expect(t.editor.postMessage).toHaveBeenCalledTimes(1);
  });

  it("shows a friendly message when the workbook cannot be loaded", async () => {
    const t = setup({ load: async () => ({ ok: false, message: "We couldn't find what you were looking for." }) });
    t.send({ type: MESSAGE.ready });
    await t.flush();
    expect(t.bridge.state()).toMatchObject({ status: "load-failed", message: expect.stringContaining("couldn't") });
    expect(t.editor.postMessage).not.toHaveBeenCalled();
  });
});

describe("who is heard (P0-BRIDGE-02, P0-BRIDGE-07)", () => {
  it("ignores messages from another origin or another window", async () => {
    const t = setup();
    t.send({ type: MESSAGE.ready }, { origin: "https://evil.example" });
    t.send({ type: MESSAGE.ready }, { source: {} });
    t.send({ type: MESSAGE.ready }, { source: null });
    await t.flush();
    expect(t.editor.postMessage).not.toHaveBeenCalled();
  });

  it("ignores malformed, unknown and oversize messages", () => {
    expect(parseIncoming(null)).toBeNull();
    expect(parseIncoming("gridcraft:ready")).toBeNull();
    expect(parseIncoming({ type: "gridcraft:unknown" })).toBeNull();
    expect(parseIncoming({ type: MESSAGE.dirty, dirty: "yes" })).toBeNull();
    expect(parseIncoming({ type: MESSAGE.save, name: "a.xlsx", bytes: "not bytes" })).toBeNull();
    expect(parseIncoming({ type: MESSAGE.save, name: "", bytes: bytes(1) })).toBeNull();
    expect(parseIncoming({ type: MESSAGE.save, name: "a.xlsx", bytes: new ArrayBuffer(0) })).toBeNull();
    expect(parseIncoming({ type: MESSAGE.save, name: "a.xlsx", bytes: bytes(1, 2, 3) }, 2)).toBeNull();
    expect(parseIncoming({ type: MESSAGE.save, name: "x".repeat(400), bytes: bytes(1) })).toBeNull();
  });

  it("reads every message in the shared contract file", () => {
    const contract = JSON.parse(readFileSync("contracts/bridge/messages.json", "utf8"));
    for (const example of contract.fromEditor) {
      const data = { ...example, ...(example.bytes ? { bytes: bytes(1, 2) } : {}) };
      expect(parseIncoming(data), example.type).not.toBeNull();
    }
    expect(contract.toEditor[0].type).toBe(MESSAGE.open);
  });
});

describe("saving (P0-BRIDGE-03, P0-BRIDGE-04, P0-BRIDGE-08)", () => {
  async function opened() {
    const t = setup();
    t.send({ type: MESSAGE.ready });
    await t.flush();
    return t;
  }

  it("saves with the base version and moves the base on success", async () => {
    const t = await opened();
    t.send({ type: MESSAGE.save, name: "Budget.xlsx", bytes: bytes(1, 2) });
    expect(t.bridge.state().status).toBe("saving");
    expect(t.saves[0].base).toBe("v1");
    t.saves[0].resolve({ ok: true, versionId: "v2" });
    await t.flush();
    expect(t.bridge.state()).toMatchObject({ status: "saved", baseVersionId: "v2" });
  });

  it("queues a save made while another is in flight, and sends only the newest", async () => {
    const t = await opened();
    t.send({ type: MESSAGE.save, name: "Budget.xlsx", bytes: bytes(1) });
    t.send({ type: MESSAGE.save, name: "Budget.xlsx", bytes: bytes(2) });
    t.send({ type: MESSAGE.save, name: "Budget.xlsx", bytes: bytes(3) });
    expect(t.saves).toHaveLength(1);
    t.saves[0].resolve({ ok: true, versionId: "v2" });
    await t.flush();
    expect(t.saves).toHaveLength(2);
    expect([...t.saves[1].bytes]).toEqual([3]);
    expect(t.saves[1].base).toBe("v2");
    t.saves[1].resolve({ ok: true, versionId: "v3" });
    await t.flush();
    expect(t.bridge.state()).toMatchObject({ status: "saved", baseVersionId: "v3" });
  });

  it("stops at a conflict, keeps the refused bytes and does not save again", async () => {
    const t = await opened();
    t.send({ type: MESSAGE.save, name: "Budget.xlsx", bytes: bytes(7) });
    t.saves[0].resolve({ ok: false, conflict: true, message: "changed" });
    await t.flush();
    expect(t.bridge.state().status).toBe("conflict");
    expect([...(t.bridge.conflictedBytes() ?? [])]).toEqual([7]);
    expect(t.bridge.hasUnsavedWork()).toBe(true);
    t.send({ type: MESSAGE.save, name: "Budget.xlsx", bytes: bytes(8) });
    expect(t.saves).toHaveLength(1);
  });

  it("reports other save failures and still lets the person save again", async () => {
    const t = await opened();
    t.send({ type: MESSAGE.save, name: "Budget.xlsx", bytes: bytes(1) });
    t.saves[0].resolve({ ok: false, conflict: false, message: "temporarily unavailable" });
    await t.flush();
    expect(t.bridge.state()).toMatchObject({ status: "save-failed", baseVersionId: "v1" });
    t.send({ type: MESSAGE.save, name: "Budget.xlsx", bytes: bytes(2) });
    expect(t.saves).toHaveLength(2);
    expect(t.saves[1].base).toBe("v1");
  });

  it("downloads exports that are not the workbook instead of saving them", async () => {
    const t = await opened();
    t.send({ type: MESSAGE.save, name: "Budget.pdf", bytes: bytes(1) });
    expect(t.deps.download).toHaveBeenCalledWith("Budget.pdf", expect.any(Uint8Array));
    expect(t.saves).toHaveLength(0);
  });
});

describe("unsaved state (P0-BRIDGE-05, P0-BRIDGE-06, P0-BRIDGE-09)", () => {
  it("follows the editor's dirty messages", async () => {
    const t = setup();
    t.send({ type: MESSAGE.ready });
    await t.flush();
    expect(t.bridge.hasUnsavedWork()).toBe(false);
    t.send({ type: MESSAGE.dirty, dirty: true });
    expect(t.bridge.state().status).toBe("unsaved");
    expect(t.bridge.hasUnsavedWork()).toBe(true);
    t.send({ type: MESSAGE.dirty, dirty: false });
    expect(t.bridge.state().status).toBe("saved");
    expect(t.bridge.hasUnsavedWork()).toBe(false);
  });

  it("reports an editor that failed to start, without keeping its error text", () => {
    const t = setup();
    t.send({ type: MESSAGE.failed, error: "wgpu adapter missing at line 42" });
    expect(t.bridge.state()).toMatchObject({ status: "editor-failed", message: null });
  });

  it("stops listening when stopped", async () => {
    const t = setup();
    t.bridge.stop();
    t.send({ type: MESSAGE.ready });
    await t.flush();
    expect(t.editor.postMessage).not.toHaveBeenCalled();
  });
});
