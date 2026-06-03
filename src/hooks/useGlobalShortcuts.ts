import { useEffect } from "react";
import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";

// Final UI Update (ui_v2) — global shortcut map (01-ia-and-shell.md §3).
//   ⌘1~⌘7 : main 4 + tools 3 화면 전환 (Today/작업 일지/변경 diff/Planner ·
//            코드 검색/터미널/AI 패널).
//   ⌘K     : Command Palette 열기.
//   ⌘,     : 설정 화면.
//   ⌘\     : AI 오버레이 토글 (보조 통로 — 기본 진입은 ⌘7 AI 패널).
//
// PR-UI 7 removed the legacy ⌘B (side panel) / ⌘J·⌘⇧J (terminal dock) / ⌘⇧\
// (detach AI window) handlers along with the Code Workbench shell. Mac ⌘ and
// Win/Linux Ctrl are treated alike; ⌘K/⌘,/숫자 stay live even inside inputs.

interface Options {
  onOpenPalette: () => void;
  /** Navigate the ui_v2 shell — ⌘1~⌘7 + ⌘, (01-ia-and-shell.md §3). */
  uiV2Nav: (view: UiV2View) => void;
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
      // ⌘, — 설정 화면
      if (e.key === ",") {
        e.preventDefault();
        uiV2Nav("settings");
        return;
      }
      // ⌘1~⌘7 — main 4 + tools 3 화면
      if (["1", "2", "3", "4", "5", "6", "7"].includes(e.key)) {
        e.preventDefault();
        const view = UI_V2_NUMBER_VIEWS[Number(e.key) - 1];
        if (view) uiV2Nav(view);
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
