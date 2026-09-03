import { useState } from "react";
import type { TerminalTab } from "@/contexts/WorkspaceContext";
import type { SessionColor } from "@/lib/sessionColors";
import { TerminalSessionMenu, type SessionMenuTarget } from "./TerminalSessionMenu";

// 세션 색 고르기의 상태·배선 (2026-09-04).
//
// `TerminalSurface` 밖에 두는 이유는 그 파일이 이미 한계를 한참 넘어 있고
// (`scripts/check-file-sizes.mjs`), 이 기능이 화면의 다른 어떤 상태와도 얽히지
// 않기 때문이다 — 여는 좌표와 고른 색이 전부다.

export interface SessionColorMenu {
  /** 카드 오른쪽 클릭에 그대로 물린다. */
  open: (id: string, e: React.MouseEvent<HTMLElement>) => void;
  /** 열려 있으면 메뉴, 아니면 `null`. 화면은 이걸 그리기만 한다. */
  node: React.ReactNode;
}

export function useSessionColorMenu(
  tabs: readonly TerminalTab[],
  patchTab: (id: string, fn: (tab: TerminalTab) => TerminalTab) => void,
): SessionColorMenu {
  const [target, setTarget] = useState<SessionMenuTarget | null>(null);

  const open = (id: string, e: React.MouseEvent<HTMLElement>) => {
    const tab = tabs.find((item) => item.id === id);
    setTarget({
      id,
      label: tab?.label ?? id,
      color: tab?.color ?? null,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const pick = (id: string, color: SessionColor | null) => {
    // 색 없음은 필드를 **지운다** — `undefined` 를 넣어 두면 저장된 상태에 빈
    // 키가 남아 "고른 적 없음"과 구분이 안 된다.
    patchTab(id, (tab) => {
      const next: TerminalTab = { ...tab };
      if (color) next.color = color;
      else delete next.color;
      return next;
    });
    setTarget(null);
  };

  return {
    open,
    node: target ? (
      <TerminalSessionMenu target={target} onPick={pick} onClose={() => setTarget(null)} />
    ) : null,
  };
}
