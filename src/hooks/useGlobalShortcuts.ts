import { useEffect } from "react";
import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { navViewForKey, NAV_BUS } from "@/lib/navRegistry";

// v2 전역 단축키 (docs/20260706_v2/01-ux-spec.md §1).
//   ⌘1~⌘9·⌘0 : 화면 전환 — navRegistry 배열 순서(=사이드바 표시 순서)에 자동
//               부여. 하드코딩 배열이 없으므로 사이드바와 어긋날 수 없다.
//   ⌘K : Command Palette 열기.
//   ⌘P : 프로젝트 전환 팝오버 (사이드바가 NAV_BUS 이벤트 수신).
//   ⌘, : 설정 화면.
//   ⌘\ : AI 오버레이 토글 (보조 통로).
// Mac ⌘ 과 Win/Linux Ctrl 동일 취급; 입력 필드 안에서도 동작 (기존 정책 유지).

interface Options {
  onOpenPalette: () => void;
  /** Navigate the ui_v2 shell — ⌘번호 + ⌘, */
  uiV2Nav: (view: UiV2View) => void;
}

export function useGlobalShortcuts({ onOpenPalette, uiV2Nav }: Options) {
  const { toggleAiOverlay } = useWorkspace();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // ⌘K — Command Palette
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      // ⌘P — 프로젝트 전환 (사이드바 팝오버)
      if (e.key.toLowerCase() === "p" && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(NAV_BUS.openProjectSwitcher));
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
      // ⌘\ — AI 오버레이 토글 (보조 통로)
      if (e.key === "\\") {
        e.preventDefault();
        toggleAiOverlay();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenPalette, uiV2Nav, toggleAiOverlay]);
}
