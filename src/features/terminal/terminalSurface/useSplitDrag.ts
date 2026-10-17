// 분할 손잡이 드래그(비율 조절) — `TerminalSurface.tsx` 에서 옮겨 왔다 (2026-09-15 분할).
// 드래그 중엔 로컬 오버레이만 그리고 pointerup 에 컨텍스트로 커밋한다. 동작 불변.
import { useState } from "react";
import type { TerminalTab } from "@/contexts/WorkspaceContext";
import { clampRatio, setRatio, type PaneDir } from "@/lib/termPanes";
import { panesOfTab } from "../activePane";

export function useSplitDrag(patchTab: (id: string, fn: (tab: TerminalTab) => TerminalTab) => void) {
  // 드래그 중 비율은 로컬 오버레이로만 그리고 pointerup 에 컨텍스트로 커밋
  // (드래그 매 프레임 전역 상태를 흔들지 않기 위해).
  const [drag, setDrag] = useState<{ tabId: string; path: string; ratio: number } | null>(null);

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    tabId: string,
    path: string,
    dir: PaneDir,
  ) => {
    e.preventDefault();
    const parent = e.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const calc = (ev: PointerEvent) =>
      clampRatio(
        dir === "row"
          ? (ev.clientX - rect.left) / Math.max(1, rect.width)
          : (ev.clientY - rect.top) / Math.max(1, rect.height),
      );
    const move = (ev: PointerEvent) => setDrag({ tabId, path, ratio: calc(ev) });
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
    };
    const up = (ev: PointerEvent) => {
      detach();
      const ratio = calc(ev);
      patchTab(tabId, (tab) => ({ ...tab, panes: setRatio(panesOfTab(tab), path, ratio) }));
    };
    // 시스템이 포인터를 가져갔다 — 커밋하지 않고 끝낸다. 듣지 않으면 리스너가
    // 남아 **다음 클릭**이 그 자리를 비율로 커밋했다 (2026-10-18).
    const cancel = () => detach();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return { drag, startDrag };
}
