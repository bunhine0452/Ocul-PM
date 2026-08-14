import { useEffect } from "react";

/**
 * 열려 있는 팝오버를 바깥 클릭·Escape 로 닫는다.
 *
 * AI 패널의 모델 메뉴와 에이전트 화면의 설정 노브가 같은 동작을 요구해 공용
 * 모듈로 뺐다 (AiPanelScreenV2 에 두면 AcpConversation 이 그걸 임포트하면서
 * 순환이 된다 — 저쪽이 이미 이쪽을 임포트한다).
 */
export function useDismiss(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}
