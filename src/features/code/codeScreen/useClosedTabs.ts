// 닫은 탭 기억(⇧⌘T)과 ⌘W — UI 로 탭을 닫는 입구가 전부 여기로 모여 되살릴 목록을 쌓는다.
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { useCallback, useEffect, useRef } from "react";

import { commands } from "@/lib/bindings";
import { registerCloseHandler } from "@/lib/closeIntent";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";

import { allOpenPaths, closeOthers, closeTab, focusedPath, type CodeTabsState } from "../codeTabs";

/** ⇧⌘T 로 되살릴 수 있는 "닫은 탭" 기억의 상한 — 무한히 쌓을 이유가 없다. */
const CLOSED_STACK_MAX = 20;

interface UseClosedTabsArgs {
  projectId: number;
  tabsRef: { current: CodeTabsState };
  setTabs: React.Dispatch<React.SetStateAction<CodeTabsState>>;
  openPath: (path: string, line: number | null) => void;
  /** 이 화면이 레이아웃 상자를 가졌는가 — 배경 프로젝트 탭은 ⌘W 를 받지 않는다. */
  isVisible: () => boolean;
}

// 의존성 배열의 `setTabs`·`tabsRef` 는 정체가 고정된 setter·ref 다 — 화면 안에
// 있을 때는 lint 가 알아서 빼 주던 것이라, 적혀 있어도 재생성 시점은 그대로다.
export function useClosedTabs({ projectId, tabsRef, setTabs, openPath, isVisible }: UseClosedTabsArgs) {
  /** UI 로 닫은 탭의 최근 순 목록 — ⇧⌘T 가 하나씩 되살린다. 삭제·외부 소실로
   *  닫힌 것은 넣지 않는다 (되살릴 파일이 없다). */
  const closedStackRef = useRef<string[]>([]);
  const rememberClosed = useCallback((...paths: string[]) => {
    const stack = closedStackRef.current.filter((p) => !paths.includes(p));
    stack.push(...paths);
    closedStackRef.current = stack.slice(-CLOSED_STACK_MAX);
  }, []);

  const closeTabTracked = useCallback(
    (pane: number, path: string) => {
      rememberClosed(path);
      setTabs((prev) => closeTab(prev, pane, path));
    },
    [rememberClosed, setTabs],
  );

  const closeOthersTracked = useCallback(
    (pane: number, path: string) => {
      const others = tabsRef.current.panes[pane]?.tabs.filter((p) => p !== path) ?? [];
      if (others.length > 0) rememberClosed(...others);
      setTabs((prev) => closeOthers(prev, pane, path));
    },
    [rememberClosed, setTabs, tabsRef],
  );

  const reopenClosedTab = useCallback(() => {
    const open = new Set(allOpenPaths(tabsRef.current));
    let path: string | undefined;
    while ((path = closedStackRef.current.pop()) !== undefined) {
      if (!open.has(path)) break;
    }
    if (path === undefined) return;
    const target = path;
    // 닫은 사이 디스크에서 사라졌을 수 있다 — 깨진 탭을 열어 두는 대신 말한다.
    void commands.codeRead(projectId, target).then((res) => {
      if (res.status === "error") {
        toast.warning(t("code.fileGone", { path: target }));
        return;
      }
      openPath(target, null);
    });
  }, [projectId, openPath, tabsRef]);

  // ⌘W — 코드 탭을 **먼저** 닫는다.
  //
  // macOS 는 메뉴 액셀러레이터가 웹뷰 keydown 보다 먼저 ⌘W 를 소비하므로,
  // 여기는 keydown 이 아니라 "안쪽부터 닫기" 사슬(lib/closeIntent)로 온다.
  // 열린 탭이 없으면 받지 않는다 — 그때의 ⌘W 는 프로젝트 탭을 닫는 것이 맞다.
  useEffect(
    () =>
      registerCloseHandler(() => {
        if (!isVisible()) return false;
        const path = focusedPath(tabsRef.current);
        if (path == null) return false;
        rememberClosed(path);
        setTabs((prev) => closeTab(prev, prev.focused, path));
        return true;
      }),
    [isVisible, rememberClosed, setTabs, tabsRef],
  );

  return { closedStackRef, closeTabTracked, closeOthersTracked, reopenClosedTab };
}
