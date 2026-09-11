/**
 * 에이전트 주의 신호 (감사 라운드 2026-09-11 C3).
 *
 * 앱 안에서 Claude Code·Codex 를 돌리는 값어치는 "안 쳐다봐도 됨" 인데,
 * 승인 카드가 떠도·턴이 끝나도 창이 뒤에 있으면 아무것도 알리지 않았다
 * (OS 알림은 일지 추가 1종뿐). 창이 **뒤에 있을 때만** 백엔드에 알림을
 * 부탁한다 — 앞에 있으면 화면이 이미 말하고 있다. 설정(`tray.notify_agent`,
 * 기본 켜짐)과 스로틀은 백엔드가 본다.
 */
import { windowApi } from "@/api/window";

export type AttentionKind = "permission" | "done" | "failed";

/** 창이 앞에 있는가 — 숨겨졌거나(다른 데스크톱·최소화) 초점을 잃었으면 뒤다. */
export function windowIsBehind(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden" || !document.hasFocus();
}

export function notifyIfBehind(kind: AttentionKind, project: string, detail: string): void {
  if (!windowIsBehind()) return;
  // 알림 실패는 알릴 일이 아니다 — 알림이 못 뜬 것을 알림으로 말할 수 없다.
  void windowApi.notifyAgentAttention(kind, project, detail.slice(0, 200)).catch(() => {});
}
