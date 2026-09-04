import { useEffect } from "react";

/**
 * ESC 로 돌던 턴을 중단한다 (`AcpConversation` 에서 갈라 나온 조각).
 *
 * 화면 어디에 포커스가 있든 먹어야 해서 `document` 에 건다. 진행 중일 때만
 * 등록하므로 다른 화면의 ESC(팝오버 닫기 등)를 뺏지 않는다.
 *
 * `isVisible` 이 있는 이유: ACP 대화 화면은 다른 화면으로 옮겨도 **살아 있다**
 * (keep-alive — 돌던 턴의 스트림이 끊기면 안 되니까). 그래서 보이는지 묻지
 * 않으면, 오늘 현황에서 팝오버를 닫으려고 누른 ESC 가 뒤에서 돌던 턴을
 * 중단시킨다.
 *
 * 파일로 나온 이유는 하나 더 있다 — `AcpConversation.tsx` 는 2,000줄을 넘어
 * 크기 래칫이 걸려 있다. 새 배선을 넣으려면 먼저 자리를 만들어야 하고,
 * 자기 완결적인 이 구독이 가장 자연스러운 조각이었다.
 */
export function useEscCancel(
  busy: boolean,
  cancel: () => void,
  isVisible: () => boolean,
): void {
  useEffect(() => {
    if (!busy) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!isVisible()) return;
      e.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [busy, cancel, isVisible]);
}
