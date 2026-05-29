import { useEffect } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";

// MASTER-GUIDE §5.9 / §부록 A — 단축키 매핑
//   ⌘1~⌘3  : 3-IA 화면 전환 (Today / Plan / Code). Lite-W6 PR7 Part 1
//             collapsed Overview into Today and re-packed the shortcuts;
//             ⌘4 / ⌘5 retire here.
//   ⌘B     : 좌측 사이드 패널 (FileTree) 토글 — Lite-W6 PR8 Part 2.
//             Workspace-level so every activeView can browse files.
//   ⌘K     : Command Palette 열기
//   ⌘,     : Settings 열기
//   ⌘\     : AI Workbench 토글  (Code 화면 한정 — W5 정식 도입 전까지 토글만)
//   ⌘J     : Terminal dock 토글 (main-only ↔ split). Lite-W6 PR7 Part 2
//             promoted Terminal to a Workspace-level dock so this works
//             from every activeView.
//   ⌘⇧J   : Terminal-only 풀스크린 (terminal-only ↔ main-only).
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
  const { setActiveView, setState, toggleSidePanel } = useWorkspace();

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
      // ⌘1~⌘3 — IA 화면 전환 (Today / Plan / Code).
      if (["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        const idx = Number(e.key) - 1;
        const map = ["today", "plan", "code"] as const;
        setActiveView(map[idx]);
        return;
      }
      // ⌘4 / ⌘5 — retired (Changelog / legacy code slot).
      if (e.key === "4" || e.key === "5") {
        e.preventDefault();
        return;
      }
      // ⌘\ — AI Workbench 토글 (W5 정식 도입 전까지 state 만 토글)
      if (e.key === "\\") {
        e.preventDefault();
        setState((prev) => ({ ...prev, aiWorkbenchOpen: !prev.aiWorkbenchOpen }));
        return;
      }
      // ⌘B — Side panel 토글 (Lite-W6 PR8 Part 2)
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidePanel();
        return;
      }
      // ⌘J / ⌘⇧J — Terminal dock layout (Lite-W6 PR7 Part 2)
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        const shift = e.shiftKey;
        setState((prev) => {
          const mode = prev.layoutMode;
          if (shift) {
            return {
              ...prev,
              layoutMode: mode === "terminal-only" ? "main-only" : "terminal-only",
            };
          }
          return {
            ...prev,
            // Toggle between hidden and split; from terminal-only land on
            // split (less surprising than going main-only and losing the
            // current command output).
            layoutMode: mode === "split" ? "main-only" : "split",
          };
        });
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenPalette, onOpenSettings, setActiveView, setState, toggleSidePanel]);
}
