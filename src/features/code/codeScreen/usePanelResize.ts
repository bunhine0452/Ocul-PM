// 하단 패널(참조·문제·디버그) 높이 (#panel-resize) — 드래그 중에는 로컬 값으로만 그리고,
// 놓는 순간 워크스페이스에 영속한다.
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { useCallback, useRef, useState } from "react";

import type { WorkspaceState } from "@/contexts/WorkspaceContext";

interface UsePanelResizeArgs {
  /** 영속된 높이 (`codePanelHeight`). */
  persistedPanelHeight: number;
  setState: React.Dispatch<React.SetStateAction<WorkspaceState>>;
}

export function usePanelResize({ persistedPanelHeight, setState }: UsePanelResizeArgs) {
  // 드래그 중에는 로컬 값으로만 그리고, 놓는 순간 영속한다 — 매 이동마다
  // 컨텍스트를 통과시키면 창 전체가 60fps 로 리렌더된다.
  const [livePanelHeight, setLivePanelHeight] = useState<number | null>(null);
  const panelHeight = livePanelHeight ?? persistedPanelHeight;
  const panelDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const clampPanelHeight = (h: number) => Math.min(560, Math.max(140, Math.round(h)));

  const persistPanelHeight = useCallback(
    (h: number) => {
      setLivePanelHeight(null);
      setState((prev) =>
        prev.codePanelHeight === h ? prev : { ...prev, codePanelHeight: h },
      );
    },
    [setState],
  );

  const onResizerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      panelDragRef.current = { startY: e.clientY, startH: panelHeight };
    },
    [panelHeight],
  );
  const onResizerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = panelDragRef.current;
    if (!drag) return;
    // 위로 끌면 커진다 (패널은 아래에 붙어 있다).
    setLivePanelHeight(clampPanelHeight(drag.startH + (drag.startY - e.clientY)));
  }, []);
  const onResizerPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = panelDragRef.current;
      if (!drag) return;
      panelDragRef.current = null;
      persistPanelHeight(clampPanelHeight(drag.startH + (drag.startY - e.clientY)));
    },
    [persistPanelHeight],
  );

  return {
    panelHeight,
    clampPanelHeight,
    persistPanelHeight,
    onResizerPointerDown,
    onResizerPointerMove,
    onResizerPointerUp,
  };
}
