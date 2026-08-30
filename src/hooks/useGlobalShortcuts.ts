import { useEffect } from "react";
import { type UiV2View } from "@/contexts/WorkspaceContext";
import { navViewForKey, NAV_BUS } from "@/lib/navRegistry";
import { requestCheatsheet } from "@/lib/projectActions";

// v2 전역 단축키 (docs/20260706_v2/01-ux-spec.md §1).
//   ⌘1~⌘9·⌘0 : 화면 전환 — navRegistry 배열 순서(=사이드바 표시 순서)에 자동
//               부여. 하드코딩 배열이 없으므로 사이드바와 어긋날 수 없다.
//   ⌘K : Command Palette 열기.
//   ⌘P : 프로젝트 전환 팝오버 (사이드바가 NAV_BUS 이벤트 수신).
//   ⌘, : 설정 화면.
//   ⌘\ : AI 패널 화면 (감사 2026-07-16 — 별도 오버레이 스택을 은퇴하고
//        단축키는 유지: 기존 손버릇이 그대로 새 정본으로 간다).
//   ⌘J : 터미널 도크 (2026-08-15) — VS Code·iTerm 의 관습 그대로.
//   ⌘/ : 단축키 치트시트 (2026-08-30) — 창에 하나 떠 있는 표를 여닫는다.
// Mac ⌘ 과 Win/Linux Ctrl 동일 취급; 입력 필드 안에서도 동작 (기존 정책 유지).

interface Options {
  onOpenPalette: () => void;
  /** Navigate the ui_v2 shell — ⌘번호 + ⌘, */
  uiV2Nav: (view: UiV2View) => void;
  /** ⌘J — 어느 화면에서나 터미널 도크를 여닫는다. */
  onToggleTerminalDock?: () => void;
  /**
   * 크롬식 탭 — 한 창에 탭이 여럿이고 **비활성 탭도 마운트된 채**라, 게이트가
   * 없으면 ⌘1 이 탭 수만큼 발화한다. 기본 true 라 런처처럼 탭이 하나뿐인
   * 곳은 그대로 쓴다.
   */
  enabled?: boolean;
}

export function useGlobalShortcuts({
  onOpenPalette,
  uiV2Nav,
  onToggleTerminalDock,
  enabled = true,
}: Options) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // ⌘K — Command Palette
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      // ⌘J — 터미널 도크. ⇧⌘J 는 넘긴다 (브라우저·OS 조합과 겹치지 않게).
      if (e.key.toLowerCase() === "j" && !e.shiftKey && onToggleTerminalDock) {
        e.preventDefault();
        onToggleTerminalDock();
        return;
      }
      // ⌘P — 프로젝트 전환 (사이드바 팝오버)
      if (e.key.toLowerCase() === "p" && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(NAV_BUS.openProjectSwitcher));
        return;
      }
      // ⌘/ — 단축키 치트시트 (창 하나에 하나, TabbedWindow 가 그린다)
      if (e.key === "/") {
        e.preventDefault();
        requestCheatsheet();
        return;
      }
      // ⌘, — 설정 화면
      if (e.key === ",") {
        e.preventDefault();
        uiV2Nav("settings");
        return;
      }
      // ⌘1~⌘9·⌘0 — navRegistry 순서
      const view = navViewForKey(e.key);
      if (view) {
        e.preventDefault();
        uiV2Nav(view);
        return;
      }
      // ⌘\ — AI 패널 화면 (프로젝트가 열려 있을 때만 의미 있음 — 셸이 가드)
      if (e.key === "\\") {
        e.preventDefault();
        uiV2Nav("ai");
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenPalette, uiV2Nav, onToggleTerminalDock, enabled]);
}
