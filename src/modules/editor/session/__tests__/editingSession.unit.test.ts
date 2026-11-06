// The editor page's session: P2-MODE-08 (mode from the role), P2-SAVE-01..03 (autosave),
// P2-LEASE-02, -03, -08, -09 (the lease as the page sees it).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_CONFIG } from "@/shared/config/appConfig";
import {
  createEditingSession,
  type LeaseAnswer,
  type SessionDeps,
  type SessionView,
  type WorkbookRoleCode,
} from "../editingSession";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(
  role: WorkbookRoleCode,
  answers: LeaseAnswer[] = [{ status: "HELD", renewSeconds: 30 }],
) {
  const views: SessionView[] = [];
  const lease = vi.fn(async (takeOver: boolean) => {
    void takeOver;
    return answers.length > 1 ? answers.shift()! : answers[0]!;
  });
  const deps: SessionDeps = {
    role,
    lease,
    release: vi.fn(),
    saveNow: vi.fn(),
    onChange: (view) => views.push(view),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as number),
    },
    autosave: APP_CONFIG.autosave,
  };
  const session = createEditingSession(deps);
  return { session, deps, views, lease };
}

describe("the mode follows the role and the lease (P2-MODE-08)", () => {
  it("Viewers open in view mode and never ask for the lease", async () => {
    const { session, lease } = setup("VIEWER");
    await session.start();
    expect(session.view()).toEqual({ mode: "view", notice: { kind: "read-only" } });
    expect(lease).not.toHaveBeenCalled();
  });

  it("Commenters open in comment mode and never ask for the lease (P2-LEASE-10)", async () => {
    const { session, lease } = setup("COMMENTER");
    await session.start();
    expect(session.view().mode).toBe("comment");
    expect(lease).not.toHaveBeenCalled();
  });

  it("Editors edit with the lease, and see who is editing without it (P2-LEASE-02)", async () => {
    const held = setup("EDITOR");
    await held.session.start();
    expect(held.session.view().mode).toBe("edit");
    const other = setup("OWNER", [{ status: "OTHER", holderName: "Asha" }]);
    await other.session.start();
    expect(other.session.view()).toEqual({
      mode: "view",
      notice: { kind: "someone-else", holderName: "Asha" },
    });
  });
});

describe("the lease", () => {
  it("renews every 30 seconds while held (P2-LEASE-03)", async () => {
    const { session, lease } = setup("EDITOR");
    await session.start();
    expect(lease).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(lease).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(lease).toHaveBeenCalledTimes(2);
    expect(lease).toHaveBeenLastCalledWith(false);
  });

  it("Refresh asks again and takes it when free (P2-LEASE-04)", async () => {
    const { session } = setup("EDITOR", [
      { status: "OTHER", holderName: "Asha" },
      { status: "HELD", renewSeconds: 30 },
    ]);
    await session.start();
    await session.refresh();
    expect(session.view().mode).toBe("edit");
  });

  it("a second tab is told, and can move editing here (P2-LEASE-08)", async () => {
    const { session, lease } = setup("EDITOR", [
      { status: "ELSEWHERE" },
      { status: "HELD", renewSeconds: 30 },
    ]);
    await session.start();
    expect(session.view().notice).toEqual({ kind: "other-tab" });
    await session.moveHere();
    expect(lease).toHaveBeenLastCalledWith(true);
    expect(session.view().mode).toBe("edit");
  });

  it("losing edit rights drops to view mode on the next renewal (P2-LEASE-09)", async () => {
    const { session } = setup("EDITOR", [
      { status: "HELD", renewSeconds: 30 },
      { status: "VIEW_ONLY" },
    ]);
    await session.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.view()).toEqual({ mode: "view", notice: { kind: "read-only" } });
  });

  it("closing the page releases a held lease", async () => {
    const { session, deps } = setup("EDITOR");
    await session.start();
    session.stop();
    expect(deps.release).toHaveBeenCalledTimes(1);
  });
});

describe("autosave (P2-SAVE-01..03)", () => {
  it("saves 5 seconds after the last change", async () => {
    const { session, deps } = setup("EDITOR");
    await session.start();
    session.dirtyChanged(true);
    await vi.advanceTimersByTimeAsync(4_000);
    session.dirtyChanged(true); // another change
    await vi.advanceTimersByTimeAsync(4_999);
    expect(deps.saveNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.saveNow).toHaveBeenCalledTimes(1);
  });

  it("saves at most 30 seconds after the first unsaved change while editing continues", async () => {
    const { session, deps } = setup("EDITOR");
    await session.start();
    session.dirtyChanged(true);
    for (let t = 0; t < 29; t++) {
      await vi.advanceTimersByTimeAsync(1_000);
      session.dirtyChanged(true);
    }
    expect(deps.saveNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.saveNow).toHaveBeenCalledTimes(1);
  });

  it("never runs in view mode (P2-SAVE-02)", async () => {
    const viewer = setup("VIEWER");
    await viewer.session.start();
    viewer.session.dirtyChanged(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(viewer.deps.saveNow).not.toHaveBeenCalled();
    const waiting = setup("EDITOR", [{ status: "OTHER", holderName: "Asha" }]);
    await waiting.session.start();
    waiting.session.dirtyChanged(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(waiting.deps.saveNow).not.toHaveBeenCalled();
  });

  it("Commenters' comments autosave too", async () => {
    const { session, deps } = setup("COMMENTER");
    await session.start();
    session.dirtyChanged(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deps.saveNow).toHaveBeenCalledTimes(1);
  });

  it("a failed save is tried again; a saved workbook is left alone (P2-SAVE-03)", async () => {
    const { session, deps } = setup("EDITOR");
    await session.start();
    session.dirtyChanged(true);
    await vi.advanceTimersByTimeAsync(5_000);
    session.saveFinished(false);
    await vi.advanceTimersByTimeAsync(APP_CONFIG.autosave.retryMs);
    expect(deps.saveNow).toHaveBeenCalledTimes(2);
    session.dirtyChanged(false);
    session.saveFinished(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.saveNow).toHaveBeenCalledTimes(2);
  });
});
