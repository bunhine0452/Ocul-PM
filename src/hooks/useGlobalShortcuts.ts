import { useEffect } from "react";
import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";

// MASTER-GUIDE §5.9 / §부록 A — 단축키 매핑
//   ⌘1~⌘3  : 3-IA 화면 전환 (Today / Plan / Code). Lite-W6 PR7 Part 1
//             collapsed Overview into Today and re-packed the shortcuts;
//             ⌘4 / ⌘5 retire here.
//   ⌘B     : 좌측 사이드 패널 (FileTree) 토글 — Lite-W6 PR8 Part 2.
//             Workspace-level so every activeView can browse files.
//   ⌘K     : Command Palette 열기
//   ⌘,     : Settings 열기
//   ⌘\     : AI 오버레이 토글 (Lite-W6 PR9: Today/Plan/Code 모두에서 호출).
//   ⌘⇧\   : AI 를 분리 윈도우로 detach (Lite-W6 PR9).
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
  /**
   * Final UI Update (ui_v2) — when provided (flag-on), ⌘1~⌘7 navigate the
   * 7 main+tool screens and ⌘, navigates to the Settings screen, instead of
   * the legacy ⌘1~⌘3 (Today/Plan/Code) + ⌘, overlay. Omitted when flag-off so
   * the legacy mapping is unchanged. (01-ia-and-shell.md §3.)
   */
  uiV2Nav?: (view: UiV2View) => void;
}

// ui_v2 ⌘1~⌘7 order (01-ia-and-shell.md §3 — main 4 then tools 3).
const UI_V2_NUMBER_VIEWS: UiV2View[] = [
  "today",    // ⌘1
  "journal",  // ⌘2
  "diff",     // ⌘3
  "planner",  // ⌘4
  "search",   // ⌘5
  "terminal", // ⌘6
  "ai",       // ⌘7
];

export function useGlobalShortcuts({ onOpenPalette, onOpenSettings, uiV2Nav }: Options) {
  const { setActiveView, setState, toggleSidePanel, toggleAiOverlay, setAiOverlayOpen } =
    useWorkspace();

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
        if (uiV2Nav) {
          uiV2Nav("settings");
        } else {
          onOpenSettings();
        }
        return;
      }
      // Final UI Update (ui_v2): ⌘1~⌘7 → 7 main/tool screens.
      if (uiV2Nav && ["1", "2", "3", "4", "5", "6", "7"].includes(e.key)) {
        e.preventDefault();
        const view = UI_V2_NUMBER_VIEWS[Number(e.key) - 1];
        if (view) uiV2Nav(view);
        return;
      }
      // ⌘1~⌘3 — legacy IA 화면 전환 (Today / Plan / Code).
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
      // ⌘\ / ⌘⇧\ — AI overlay / detached window (Lite-W6 PR9)
      if (e.key === "\\") {
        e.preventDefault();
        if (e.shiftKey) {
          // Detach into the standalone AI window. The backend is idempotent
          // (focus + unminimise on re-invocation) so repeated ⌘⇧\ just
          // raises the existing window.
          setAiOverlayOpen(false);
          void import("@/lib/bindings").then(({ commands }) =>
            commands.openAiWindow().then((res) => {
              if (res.status === "error") {
                console.error("[ai] openAiWindow:", res.error);
              }
            }),
          );
          return;
        }
        toggleAiOverlay();
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
  }, [
    onOpenPalette,
    onOpenSettings,
    uiV2Nav,
    setActiveView,
    setState,
    toggleSidePanel,
    toggleAiOverlay,
    setAiOverlayOpen,
  ]);
}
