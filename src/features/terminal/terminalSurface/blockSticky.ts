import type { Terminal } from "@xterm/xterm";

import { blockTone, type CommandBlock } from "../commandBlocks";

/**
 * 스티키 헤더 — 긴 출력을 스크롤하는 동안 "지금 보는 게 어느 명령의 출력인가"를 위에 고정한다.
 *
 * **React 를 쓰지 않는다.** 스크롤마다 상태를 올리면 초당 수십 번 페인 트리가 재렌더된다.
 * 여기서는 textContent 만 바꾼다. (`TerminalInstanceImpl` 에서 떼어 낸 조각 — 파일 크기 래칫.)
 */
export function mountBlockSticky(
  container: HTMLElement | null,
  term: Terminal,
  snapshot: () => CommandBlock[],
): { update: () => void; dispose: () => void } {
  const sticky = document.createElement("div");
  sticky.className = "term-block-sticky";
  sticky.hidden = true;
  container?.appendChild(sticky);
  const update = () => {
    // 전체화면 TUI 에서는 블록 자체가 의미 없다 (→ agentMode 주석).
    if (term.buffer.active.type === "alternate") {
      sticky.hidden = true;
      return;
    }
    const top = term.buffer.active.viewportY;
    let current: CommandBlock | null = null;
    for (const block of snapshot()) {
      if (block.line < top) current = block;
      else break;
    }
    if (!current) {
      sticky.hidden = true;
      return;
    }
    sticky.hidden = false;
    sticky.dataset.tone = blockTone(current);
    sticky.textContent = current.command;
  };
  return { update, dispose: () => sticky.remove() };
}
