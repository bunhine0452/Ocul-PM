/**
 * 키로 프로젝트 창 바꾸기 (ocul-next #nav-projects) — macOS ⌥⌘1~9, Windows·Linux Alt+1~9.
 *
 * 번호는 ⌘O 목록에 보이는 순서(최근 순)다 — 목록의 줄마다 그 키를 적는다. 다른 키를 못 쓰는 까닭:
 * ⌃숫자는 macOS 에서 ⌘숫자처럼 읽혀(`readChord`) 화면 전환(⌘1~5)과 겹치고, Windows·Linux 에서는
 * Ctrl+숫자가 곧 화면 전환이다. ⇧⌘3~5 는 macOS 스크린샷이고, Ctrl+Alt 는 유럽 자판의 AltGr 다.
 * 터미널 안의 Alt+숫자는 셸(readline)의 것이라 Windows·Linux 에서는 그 위에서 받지 않는다.
 */
import { isTerminalTarget, kbd } from "@/lib/kbd";
import { isMac } from "@/lib/platform";

export const PROJECT_SLOTS = 9;

type SlotEvent = Pick<KeyboardEvent, "code" | "metaKey" | "altKey" | "ctrlKey" | "shiftKey" | "target">;

/** 이 키가 몇 번째 프로젝트(0 부터)를 부르는가 — 아니면 `null`. ⌥ 가 글자를 바꾸므로 `code` 로 읽는다. */
export function projectSlotOf(e: SlotEvent): number | null {
  const m = /^Digit([1-9])$/.exec(e.code);
  if (!m || e.shiftKey || e.ctrlKey) return null;
  if (isMac()) {
    if (!e.metaKey || !e.altKey) return null;
  } else if (!e.altKey || e.metaKey || isTerminalTarget(e.target)) {
    return null;
  }
  return Number(m[1]) - 1;
}

export function projectSlotLabel(slot: number): string {
  // kbd() 로는 못 옮긴다 — 그 OS 의 키는 Ctrl+Alt 가 아니라 Alt 다.
  return isMac() ? kbd(`⌥⌘${slot + 1}`) : `Alt+${slot + 1}`;
}

/**
 * 급한 프로젝트를 위로 (11-02 기다림 신호) — Claude 가 기다리는 것, 다음이 확인 명령이 실패한 것, 나머지.
 * 같은 무리 안에서는 들어온 순서(최근 순)를 지킨다. ⌘O 목록과 ⌥⌘ 번호가 **같은 순서**를 써야 번호가 맞는다.
 */
export function byAttention<T extends { id: number }>(
  ordered: readonly T[],
  attention: ReadonlyMap<number, { waiting: number; failing: boolean }>,
): T[] {
  const rank = (p: T) => {
    const a = attention.get(p.id);
    return a?.waiting ? 0 : a?.failing ? 1 : 2;
  };
  return ordered
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}
