// 자동 저장(B2)의 트리거 — docs/20260902_vscode-borrows/01-save-hygiene.md §B2.
//
// "언제 저장하는가" 만 여기서 잠근다. 어떻게 쓰는지(낙관적 잠금·충돌 배너)는
// CodePane 의 몫이고 code_screen.test.tsx 가 본다.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { AUTO_SAVE_MIN_DELAY_MS, autoSaveDelayMs, useAutoSave } from "@/features/code/autoSave";
import type { AutoSaveMode } from "@/lib/settings";

interface Harness {
  mode: AutoSaveMode;
  delayMs: number;
  activePath: string | null;
  isFocused: boolean;
  can: boolean;
  saveActive: Mock<() => void>;
  flushPath: Mock<(path: string) => void>;
}

function harness(over: Partial<Harness> = {}): Harness {
  return {
    mode: "afterDelay",
    delayMs: 1000,
    activePath: "a.ts",
    isFocused: true,
    can: true,
    saveActive: vi.fn<() => void>(),
    flushPath: vi.fn<(path: string) => void>(),
    ...over,
  };
}

function mount(h: Harness) {
  return renderHook((props: Harness) => useAutoSave({ ...props, canAutoSave: () => props.can }), {
    initialProps: h,
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("autoSaveDelayMs", () => {
  it("하한 250ms 를 강제한다 — 저장마다 워처가 색인을 예약한다", () => {
    expect(autoSaveDelayMs(50)).toBe(AUTO_SAVE_MIN_DELAY_MS);
    expect(autoSaveDelayMs(1000)).toBe(1000);
  });

  it("쓰레기 값은 기본값으로 접는다", () => {
    expect(autoSaveDelayMs(Number.NaN)).toBe(1000);
    expect(autoSaveDelayMs(0)).toBe(1000);
    expect(autoSaveDelayMs(-5)).toBe(1000);
  });
});

describe("useAutoSave — afterDelay", () => {
  it("타자가 멈춘 뒤 한 번만 저장한다", () => {
    const h = harness();
    const { result } = mount(h);
    act(() => {
      result.current.onEdit();
      result.current.onEdit();
      result.current.onEdit();
    });
    expect(h.saveActive).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1000));
    expect(h.saveActive).toHaveBeenCalledTimes(1);
  });

  it("게이트가 막으면 조용히 지나간다 (충돌 배너·비교 모드·이미 저장됨)", () => {
    const h = harness({ can: false });
    const { result } = mount(h);
    act(() => result.current.onEdit());
    act(() => void vi.advanceTimersByTime(1000));
    expect(h.saveActive).not.toHaveBeenCalled();
  });

  it("포커스가 나가도 이 방식에서는 저장하지 않는다", () => {
    const h = harness();
    const { result } = mount(h);
    act(() => result.current.onEditorBlur());
    expect(h.saveActive).not.toHaveBeenCalled();
  });
});

describe("useAutoSave — onFocusChange", () => {
  it("에디터에서 포커스가 나가면 저장한다", () => {
    const h = harness({ mode: "onFocusChange" });
    const { result } = mount(h);
    act(() => result.current.onEditorBlur());
    expect(h.saveActive).toHaveBeenCalledTimes(1);
  });

  it("타자만으로는 저장하지 않는다", () => {
    const h = harness({ mode: "onFocusChange" });
    const { result } = mount(h);
    act(() => result.current.onEdit());
    act(() => void vi.advanceTimersByTime(5000));
    expect(h.saveActive).not.toHaveBeenCalled();
  });

  it("창이 포커스를 잃을 때만 — 마운트만으로는 아니다", () => {
    const h = harness({ mode: "onFocusChange", isFocused: false });
    const { rerender } = mount(h);
    expect(h.saveActive).not.toHaveBeenCalled();
    rerender({ ...h, isFocused: true });
    expect(h.saveActive).not.toHaveBeenCalled();
    rerender({ ...h, isFocused: false });
    expect(h.saveActive).toHaveBeenCalledTimes(1);
  });
});

describe("useAutoSave — 떠난 파일", () => {
  it("탭을 옮기면 **떠난** 경로를 저장한다 (새 경로가 아니라)", () => {
    const h = harness();
    const { rerender } = mount(h);
    rerender({ ...h, activePath: "b.ts" });
    expect(h.flushPath).toHaveBeenCalledWith("a.ts");
  });

  it("아직 안 터진 타이머는 경로가 바뀌면 취소된다 — 다른 파일을 저장하지 않게", () => {
    const h = harness();
    const { result, rerender } = mount(h);
    act(() => result.current.onEdit());
    rerender({ ...h, activePath: "b.ts" });
    act(() => void vi.advanceTimersByTime(5000));
    expect(h.saveActive).not.toHaveBeenCalled();
    expect(h.flushPath).toHaveBeenCalledWith("a.ts");
  });

  it("창이 사라져도 (화면 전환·분할 해제) 마지막 파일을 저장한다", () => {
    const h = harness();
    const { unmount } = mount(h);
    unmount();
    expect(h.flushPath).toHaveBeenCalledWith("a.ts");
  });
});

describe("useAutoSave — off", () => {
  it("아무 트리거에도 반응하지 않는다", () => {
    const h = harness({ mode: "off" });
    const { result, rerender, unmount } = mount(h);
    act(() => result.current.onEdit());
    act(() => result.current.onEditorBlur());
    act(() => void vi.advanceTimersByTime(5000));
    rerender({ ...h, activePath: "b.ts" });
    unmount();
    expect(h.saveActive).not.toHaveBeenCalled();
    expect(h.flushPath).not.toHaveBeenCalled();
  });
});
