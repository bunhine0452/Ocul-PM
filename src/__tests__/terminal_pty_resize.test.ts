/**
 * PTY 크기 통보의 직렬화·합치기 (2026-09-01).
 *
 * 터미널을 줄였다 키우면 글자가 깨지고, claude code 의 출력이 두 번 찍히고,
 * 위로 스크롤하면 그 잔해가 남아 있었다. 근거는 `ptyResize.ts` 주석에 있다 —
 * 여기서는 큐가 지켜야 할 세 가지를 못박는다.
 *
 *  1) 한 번에 하나만 날아간다 (앞선 통보의 응답 전에 다음이 나가지 않는다)
 *  2) 그 사이 쌓인 것은 **마지막 하나로 접힌다** — 중간 크기가 PTY 에 굳는
 *     경로가 바로 이것이었다
 *  3) 같은 크기는 두 번 보내지 않는다 (SIGWINCH 한 번 = 전체화면 다시 그리기)
 */
import { describe, it, expect, vi } from "vitest";

import { createPtyResizeQueue } from "@/features/terminal/ptyResize";

/** 응답 시점을 테스트가 쥐는 sender. */
function deferredSender() {
  const calls: { rows: number; cols: number }[] = [];
  const resolvers: (() => void)[] = [];
  const send = (rows: number, cols: number) => {
    calls.push({ rows, cols });
    return new Promise<void>((resolve) => resolvers.push(resolve));
  };
  return {
    calls,
    send,
    /** 가장 오래된 미완 요청을 성공으로 끝낸다. */
    async settle() {
      const next = resolvers.shift();
      expect(next).toBeDefined();
      next?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("PTY resize 큐", () => {
  it("응답이 오기 전에는 다음 통보를 내보내지 않는다", async () => {
    const s = deferredSender();
    const q = createPtyResizeQueue(s.send);

    q.push(24, 80);
    q.push(25, 90);
    q.push(30, 100);

    expect(s.calls).toEqual([{ rows: 24, cols: 80 }]);
  });

  it("기다리는 동안 쌓인 크기는 마지막 하나로 접힌다", async () => {
    const s = deferredSender();
    const q = createPtyResizeQueue(s.send);

    // 분할 막대를 끄는 동안 프레임마다 들어오는 중간 크기들.
    q.push(24, 80);
    q.push(25, 90);
    q.push(26, 95);
    q.push(30, 100);
    await s.settle();

    // 중간 크기(90·95)는 건너뛰고 손을 뗀 크기로 바로 간다.
    expect(s.calls).toEqual([
      { rows: 24, cols: 80 },
      { rows: 30, cols: 100 },
    ]);
  });

  it("마지막에 PTY 가 받는 것은 언제나 최종 크기다", async () => {
    const s = deferredSender();
    const q = createPtyResizeQueue(s.send);

    for (let cols = 80; cols <= 120; cols += 1) q.push(30, cols);
    await s.settle();
    await s.settle();

    expect(s.calls[s.calls.length - 1]).toEqual({ rows: 30, cols: 120 });
    expect(q.lastSent).toEqual({ rows: 30, cols: 120 });
  });

  it("직전에 보낸 것과 같은 크기는 다시 보내지 않는다", async () => {
    const s = deferredSender();
    const q = createPtyResizeQueue(s.send);

    q.push(30, 100);
    await s.settle();
    q.push(30, 100);
    q.push(30, 100);

    expect(s.calls).toHaveLength(1);
  });

  it("세션이 새로 뜨면 reset 이 중복 판정을 지운다", async () => {
    const s = deferredSender();
    const q = createPtyResizeQueue(s.send);

    q.push(30, 100);
    await s.settle();
    // 같은 크기지만 PTY 는 방금 새로 생겼다 — 반드시 다시 알려야 한다.
    q.reset();
    q.push(30, 100);

    expect(s.calls).toEqual([
      { rows: 30, cols: 100 },
      { rows: 30, cols: 100 },
    ]);
  });

  it("전송이 실패하면 같은 크기를 다시 시도할 수 있게 기억을 지운다", async () => {
    const send = vi
      .fn<(rows: number, cols: number) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("pty-host connection lost"))
      .mockResolvedValue(undefined);
    const q = createPtyResizeQueue(send);

    q.push(30, 100);
    await Promise.resolve();
    await Promise.resolve();
    expect(q.lastSent).toBeNull();

    q.push(30, 100);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("의미 없는 치수는 PTY 로 내보내지 않는다", () => {
    const send = vi.fn<(rows: number, cols: number) => Promise<unknown>>().mockResolvedValue(undefined);
    const q = createPtyResizeQueue(send);

    q.push(0, 100);
    q.push(30, 0);
    q.push(-1, -1);
    q.push(Number.NaN, 80);

    expect(send).not.toHaveBeenCalled();
  });

  it("dispose 뒤에는 아무것도 나가지 않는다", async () => {
    const s = deferredSender();
    const q = createPtyResizeQueue(s.send);

    q.push(24, 80);
    q.push(30, 100);
    q.dispose();
    await s.settle();

    expect(s.calls).toEqual([{ rows: 24, cols: 80 }]);
  });
});
