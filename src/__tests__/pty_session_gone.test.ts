// 호스트째 사라진 세션 — 거절을 종료와 같은 신호로 읽는다 (ptyWrite.ts, 2026-10-24).
import { describe, expect, it, vi } from "vitest";

import { createPtyInputGate, isSessionGone, onceSessionEnded } from "@/features/terminal/ptyWrite";

describe("isSessionGone", () => {
  it("recognises the 'unknown session' wording from both the host and the app", () => {
    expect(isSessionGone("unknown pty session: p2-abc")).toBe(true);
    expect(isSessionGone("PTY input queue is full")).toBe(false);
    expect(isSessionGone("pty-host connection lost")).toBe(false);
  });
});

describe("onceSessionEnded", () => {
  it("runs once even when the exit event and a rejection overlap", () => {
    const end = vi.fn();
    const gone = onceSessionEnded(end);
    gone();
    gone();
    gone();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("shows one banner when queued keys are rejected back to back (wired to the gate)", async () => {
    const end = vi.fn();
    const gone = onceSessionEnded(end);
    const report = vi.fn();
    const write = vi.fn(async () => ({ status: "error" as const, error: "unknown pty session: p1-x" }));
    const gate = createPtyInputGate("p1-x", write, undefined, (e) => (isSessionGone(e) ? gone() : report(e)));
    gate.open();
    gate.push("a");
    gate.push("b");
    gate.push("c");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    await Promise.resolve();
    expect(end).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });
});
