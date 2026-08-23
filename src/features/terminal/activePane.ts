// 지금 키 입력이 향하는 페인 = 활성 탭의 포커스된 세션 id.
//
// 터미널 본체(TerminalSurface)만 알던 계산인데, 디스패치 핸드오프가 **터미널을
// 그리지 않는 화면에서도** 같은 답을 알아야 해서(플래너 ▶실행이 도크에 그대로
// 꽂히려면) 밖으로 뺐다. PTY 는 Rust 에 살아 있고 sid 만 알면 어느 화면에서든
// 쓸 수 있으므로, 이 계산이 곧 "어디로 보낼까"의 전부다.

import { leaf, collectSids, firstSid, type PaneNode } from "@/lib/termPanes";
import type { TerminalTab } from "@/contexts/WorkspaceContext";

/** 분할이 없는 탭은 페인 트리를 갖지 않는다 — 잎 하나로 본다. */
export function panesOfTab(tab: TerminalTab): PaneNode {
  return tab.panes ?? leaf(tab.id);
}

/** 이 탭에서 포커스된 페인. 기억된 포커스가 사라졌으면 첫 페인. */
export function focusOfTab(tab: TerminalTab): string {
  const panes = panesOfTab(tab);
  const sids = collectSids(panes);
  return tab.focusSid && sids.includes(tab.focusSid) ? tab.focusSid : firstSid(panes);
}

/**
 * 활성 탭의 포커스된 세션 id. 탭이 하나도 없으면 `null`.
 *
 * **살아있는 PTY 라는 보장은 없다** — 탭 목록은 영속되므로 앱을 다시 켠 직후엔
 * 셸이 아직 없는 sid 가 나온다. 살아있는지는 쓰기를 시도해 본 쪽이 판단한다.
 */
export function activeSid(
  tabs: readonly TerminalTab[],
  activeId: string | null,
): string | null {
  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  return tab ? focusOfTab(tab) : null;
}
