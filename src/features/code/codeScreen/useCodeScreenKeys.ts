// 코드 화면 단축키 — 탭 순환·닫은 탭 되살리기·전역 검색·빠른 열기·줄바꿈·사이드바·
// 파일 안 이동·트리 ⌘X/⌘V·새 파일. 이 화면이 보일 때만 받는다.
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { useEffect } from "react";

import { cycleTab, focusedPath, type CodeTabsState } from "../codeTabs";
import { parentDir } from "../fileOps";
import type { TreeHit } from "../importTarget";

interface UseCodeScreenKeysArgs {
  isVisible: () => boolean;
  tabsRef: { current: CodeTabsState };
  setTabs: React.Dispatch<React.SetStateAction<CodeTabsState>>;
  quickOpenFilesRef: { current: readonly unknown[] };
  setQuickOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openGoto: (lineMode: boolean) => void;
  toggleWordWrap: () => void;
  toggleSidebar: () => void;
  reopenClosedTab: () => void;
  openSearch: () => void;
  pasteHere: () => void;
  cutFrom: (at: TreeHit | null) => void;
  startCreate: (parent: string, isDir: boolean) => void;
}

/**
 * 화면 단축키 — 이 화면이 보일 때만.
 *   ⌃Tab / ⌃⇧Tab · ⇧⌘] / ⇧⌘[ : 탭 순환 (브라우저·VS Code 관례 양쪽)
 *   ⇧⌘T : 닫은 탭 다시 열기
 *   ⇧⌘F : 전역 검색 (사이드바를 검색 패널로 전환 + 입력 포커스)
 *   ⌘N : 새 파일 (보고 있던 파일의 폴더에)
 *   ⇧⌘O / ⌃G : 파일 안에서 심볼·줄로 이동
 * ⌘W 는 여기 없다 — macOS 는 메뉴 액셀러레이터가 keydown 보다 먼저 먹으므로
 * closeIntent 사슬(`useClosedTabs`)이 받는다. keydown 에도 달면 두 번 닫힌다.
 */
export function useCodeScreenKeys({
  isVisible,
  tabsRef,
  setTabs,
  quickOpenFilesRef,
  setQuickOpen,
  openGoto,
  toggleWordWrap,
  toggleSidebar,
  reopenClosedTab,
  openSearch,
  pasteHere,
  cutFrom,
  startCreate,
}: UseCodeScreenKeysArgs): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isVisible()) return;
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
        e.preventDefault();
        setTabs((prev) => cycleTab(prev, e.shiftKey ? -1 : 1));
        return;
      }
      // ⌃G — CM6 기본 키맵에 없는 조합이라 여기서 처음 잡힌다 (emacs 키맵을
      // 쓰지 않는다). ⌘ 조합보다 먼저 봐야 아래 metaKey 게이트에 안 걸린다.
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        openGoto(true);
        return;
      }
      // ⌥Z — 줄바꿈. `code` 로 본다: macOS 에서 ⌥Z 의 `key` 는 "Ω" 다.
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === "KeyZ") {
        e.preventDefault();
        toggleWordWrap();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (!e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        if (quickOpenFilesRef.current.length > 0) setQuickOpen(true);
        return;
      }
      if (!e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      // 괄호 키는 `key` 가 아니라 `code` 로 본다 — ⇧ 조합·비영어 자판에서
      // `key` 값이 갈라진다.
      if (e.shiftKey && (e.code === "BracketRight" || e.code === "BracketLeft")) {
        e.preventDefault();
        setTabs((prev) => cycleTab(prev, e.code === "BracketRight" ? 1 : -1));
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        reopenClosedTab();
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openGoto(false);
        return;
      }
      // 편집면(`.monaco-editor`)·입력칸의 ⌘X/⌘V 는 글자 잘라내기·붙여넣기다 — 가로채면 타이핑이 망가진다.
      const editing = (e.target as HTMLElement | null)?.closest?.(
        ".monaco-editor, input, textarea, [contenteditable='true']",
      );
      if (!e.shiftKey && e.key.toLowerCase() === "v") {
        if (editing) return;
        pasteHere();
        return;
      }
      if (!e.shiftKey && e.key.toLowerCase() === "x") {
        if (editing) return;
        e.preventDefault();
        cutFrom(null);
        return;
      }
      if (!e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        const current = focusedPath(tabsRef.current);
        startCreate(current != null ? parentDir(current) : "", false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isVisible,
    reopenClosedTab,
    startCreate,
    openSearch,
    pasteHere,
    cutFrom,
    openGoto,
    toggleWordWrap,
    toggleSidebar,
    // 아래 넷은 정체가 고정된 setter·ref 다 — 원래 화면 안에서는 lint 가 알아서
    // 빼 주던 것이라, 여기 적혀 있어도 effect 는 위 아홉이 바뀔 때만 다시 건다.
    tabsRef,
    setTabs,
    quickOpenFilesRef,
    setQuickOpen,
  ]);
}
