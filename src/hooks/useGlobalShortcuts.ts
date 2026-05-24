import { useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";

// MASTER-GUIDE §5.9 / §부록 A — 단축키 매핑
//   ⌘1~⌘5  : 5-IA 화면 전환 (Today / Overview / Plan / Changelog / Code).
//             W3-PR4: Today promoted to ⌘1. App.tsx PRIMARY_NAV mirrors this.
//   ⌘K     : Command Palette 열기
//   ⌘,     : Settings 열기
//   ⌘\     : AI Workbench 토글  (Code 화면 한정 — W5 정식 도입 전까지 토글만)
//   ⌘J     : Bottom Drawer 토글 (Code 화면 한정)
//   ⌘N     : (Plan 화면에서) 새 목표 — Plan 화면이 자체 처리하면 됨; 여기선 이벤트만.
//
// Mac 의 ⌘ 와 Win/Linux 의 Ctrl 을 동일하게 처리. 텍스트 입력 중에는 ⌘K/⌘,/숫자
// 단축키도 차단하지 않는다 — Command Palette/Settings 는 사용자가 input 안에서도
// 부르고 싶을 수 있기 때문.

interface Options {
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}

export function useGlobalShortcuts({ onOpenPalette, onOpenSettings }: Options) {
  const { setActiveView, setState } = useWorkspace();

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
      // ⌘, — Settings
      if (e.key === ",") {
        e.preventDefault();
        onOpenSettings();
        return;
      }
      // ⌘1~⌘5 — IA 화면 전환 (W3-PR4: Today/Overview swap)
      if (["1", "2", "3", "4", "5"].includes(e.key)) {
        e.preventDefault();
        const map = ["today", "overview", "plan", "changelog", "code"] as const;
        setActiveView(map[Number(e.key) - 1]);
        return;
      }
      // ⌘\ — AI Workbench 토글 (W5 정식 도입 전까지 state 만 토글)
      if (e.key === "\\") {
        e.preventDefault();
        setState((prev) => ({ ...prev, aiWorkbenchOpen: !prev.aiWorkbenchOpen }));
        return;
      }
      // ⌘J — Bottom Drawer 토글
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        setState((prev) => ({ ...prev, bottomDrawerOpen: !prev.bottomDrawerOpen }));
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenPalette, onOpenSettings, setActiveView, setState]);
}
