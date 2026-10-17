import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useSplitDrag } from "@/features/terminal/terminalSurface/useSplitDrag";

// 분할 손잡이 드래그가 **취소**를 몰랐던 것 (2026-10-18).
//
// pointerup 만 들었기 때문에 시스템이 포인터를 가져가면(pointercancel) 창에 단
// 리스너가 그대로 남았다 — 손을 뗀 뒤 아무 데나 누르는 다음 클릭이 그 자리를
// 비율로 커밋해 분할이 엉뚱하게 튀었다. 코드 트리 드래그(`useTreeDrag`)는 이미
// 취소를 듣는다.

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

describe("split divider drag", () => {
  test("pointerup commits the ratio", () => {
    const patchTab = vi.fn();
    const { result } = renderHook(() => useSplitDrag(patchTab));
    act(() => result.current.startDrag(grip(), "t1", "", "row"));
    act(() => {
      pointer("pointerup", 60);
    });
    expect(patchTab).toHaveBeenCalledTimes(1);
    expect(result.current.drag).toBeNull();
  });

  test("a cancelled drag ends without committing — a later click does nothing", () => {
    const patchTab = vi.fn();
    const { result } = renderHook(() => useSplitDrag(patchTab));
    act(() => result.current.startDrag(grip(), "t1", "", "row"));
    act(() => {
      pointer("pointermove", 120);
    });
    expect(result.current.drag).not.toBeNull();
    act(() => {
      pointer("pointercancel", 120);
    });
    expect(result.current.drag).toBeNull();
    act(() => {
      pointer("pointerup", 20);
      pointer("pointermove", 40);
    });
    expect(patchTab).not.toHaveBeenCalled();
    expect(result.current.drag).toBeNull();
  });
});
