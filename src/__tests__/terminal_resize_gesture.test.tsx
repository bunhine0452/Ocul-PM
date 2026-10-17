import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { TerminalDock } from "@/features/terminal/TerminalDock";

import {
  beginResizeGesture,
  isResizeGestureActive,
  onResizeGestureEnd,
  resetResizeGestureForTest,
} from "@/features/terminal/resizeGesture";
import { useSplitDrag } from "@/features/terminal/terminalSurface/useSplitDrag";
import { createPtyResizeQueue } from "@/features/terminal/ptyResize";

// 손잡이를 끄는 동안 PTY 에는 크기를 보내지 않는다 (2026-10-18).
//
// Claude Code 는 SIGWINCH 마다 보이는 화면을 새 폭으로 다시 찍는다. 끄는 도중
// 손이 60ms 만 멎어도 중간 폭이 새어 나가 그 폭으로 다시 찍힌 줄(진짜 개행)이
// 스크롤백에 남았고, 다시 넓혀도 펴지지 않았다. xterm 은 끄는 동안에도 화면을
// 맞추되(리플로는 되돌릴 수 있다), PTY 통보는 손을 뗀 뒤 한 번만 나간다.

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy({}, { get: () => () => ok(null) }),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});
// xterm 은 jsdom 에서 안 뜬다 — 도크의 손잡이만 본다.
vi.mock("@/features/terminal/TerminalSurface", () => ({ TerminalSurface: () => <div /> }));

afterEach(() => {
  cleanup();
  resetResizeGestureForTest();
});

describe("resize gesture gate", () => {
  test("is active between begin and end, and notifies once on end", () => {
    const ended = vi.fn();
    const off = onResizeGestureEnd(ended);
    expect(isResizeGestureActive()).toBe(false);
    const end = beginResizeGesture();
    expect(isResizeGestureActive()).toBe(true);
    end();
    end(); // 두 번 불러도 한 번만 끝난다 (pointerup 과 cancel 이 겹칠 수 있다)
    expect(isResizeGestureActive()).toBe(false);
    expect(ended).toHaveBeenCalledTimes(1);
    off();
  });

  test("overlapping gestures stay active until the last one ends", () => {
    const ended = vi.fn();
    onResizeGestureEnd(ended);
    const a = beginResizeGesture();
    const b = beginResizeGesture();
    a();
    expect(isResizeGestureActive()).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    b();
    expect(isResizeGestureActive()).toBe(false);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  test("an unsubscribed listener is not called", () => {
    const ended = vi.fn();
    const off = onResizeGestureEnd(ended);
    off();
    beginResizeGesture()();
    expect(ended).not.toHaveBeenCalled();
  });
});

function grip(width = 200) {
  const parent = document.createElement("div");
  parent.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height: 100, right: width, bottom: 100, x: 0, y: 0 }) as DOMRect;
  const handle = document.createElement("div");
  parent.appendChild(handle);
  return { preventDefault: () => {}, currentTarget: handle } as unknown as React.PointerEvent<HTMLDivElement>;
}

const pointer = (type: string, clientX: number) =>
  window.dispatchEvent(Object.assign(new Event(type), { clientX, clientY: 0 }));

describe("split divider drag holds the gate", () => {
  test("open while dragging, closed on pointerup", () => {
    const { result } = renderHook(() => useSplitDrag(vi.fn()));
    act(() => result.current.startDrag(grip(), "t1", "", "row"));
    expect(isResizeGestureActive()).toBe(true);
    act(() => {
      pointer("pointerup", 60);
    });
    expect(isResizeGestureActive()).toBe(false);
  });

  test("closed on pointercancel too", () => {
    const { result } = renderHook(() => useSplitDrag(vi.fn()));
    act(() => result.current.startDrag(grip(), "t1", "", "row"));
    act(() => {
      pointer("pointercancel", 60);
    });
    expect(isResizeGestureActive()).toBe(false);
  });
});

describe("dock grip drag holds the gate", () => {
  test("open while dragging, closed on pointerup", async () => {
    const { container } = render(
      <WorkspaceProvider projectId={71}>
        <TerminalDock projectId={71} projectRoot="/tmp" />
      </WorkspaceProvider>,
    );
    await act(async () => {});
    const handle = container.querySelector(".term-dock-grip");
    expect(handle).not.toBeNull();
    fireEvent.pointerDown(handle!);
    expect(isResizeGestureActive()).toBe(true);
    act(() => {
      pointer("pointerup", 0);
    });
    expect(isResizeGestureActive()).toBe(false);
  });
});

describe("PTY resize queue during a gesture", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test("holds every size while dragging and sends only the final one on release", async () => {
    const sent: Array<[number, number]> = [];
    let current: [number, number] = [24, 80];
    const q = createPtyResizeQueue(
      async (rows, cols) => {
        sent.push([rows, cols]);
      },
      () => q.push(...current),
    );
    const end = beginResizeGesture();
    for (const cols of [70, 50, 40, 60]) {
      current = [24, cols];
      q.push(24, cols);
      await flush();
    }
    expect(sent).toEqual([]);
    current = [24, 100];
    end();
    await flush();
    expect(sent).toEqual([[24, 100]]);
    q.dispose();
  });

  test("without refit, the last held size goes out on release", async () => {
    const sent: Array<[number, number]> = [];
    const q = createPtyResizeQueue(async (rows, cols) => {
      sent.push([rows, cols]);
    });
    const end = beginResizeGesture();
    q.push(24, 50);
    q.push(24, 90);
    end();
    await flush();
    expect(sent).toEqual([[24, 90]]);
    q.dispose();
  });

  test("a disposed queue ignores the gesture end", async () => {
    const send = vi.fn(async () => {});
    const refit = vi.fn();
    const q = createPtyResizeQueue(send, refit);
    const end = beginResizeGesture();
    q.push(24, 50);
    q.dispose();
    end();
    await flush();
    expect(refit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
