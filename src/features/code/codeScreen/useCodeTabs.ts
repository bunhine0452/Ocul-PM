// 코드 화면의 **탭 목록** — 어떤 파일이 어느 창에 열렸는가, 미저장 표시, 줄 점프,
// 그리고 워크스페이스 영속(`codeTabs`)의 유일한 쓰기 자리.
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceState } from "@/contexts/WorkspaceContext";

import type { CodePaneHandle } from "../CodePane";
import { listDirtyPaths } from "../codeBuffers";
import {
  allOpenPaths,
  focusedPath,
  openFile,
  pinTab,
  sanitizeTabs,
  type CodeTabsState,
} from "../codeTabs";

/** 창별 줄 점프 지시 — nonce 로 같은 줄의 연속 점프도 다시 발화시킨다. */
export interface CodeJump {
  pane: number;
  line: number;
  ch?: number;
  len?: number;
  /** false 면 에디터가 포커스를 가져가지 않는다 (⇧⌘O 의 미리 점프). */
  focus?: boolean;
  nonce: number;
}

interface UseCodeTabsArgs {
  projectId: number;
  /** 되살릴 탭 — 초기값으로 한 번만 읽는다. */
  persistedTabs: WorkspaceState["codeTabs"];
  /** 설정 `codePreviewTabs` — 여는 순간 ref 로 읽는다. */
  previewTabs: boolean;
  setState: React.Dispatch<React.SetStateAction<WorkspaceState>>;
}

export function useCodeTabs({ projectId, persistedTabs, previewTabs, setState }: UseCodeTabsArgs) {
  const [tabs, setTabs] = useState<CodeTabsState>(() => sanitizeTabs(persistedTabs));
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  // 여는 순간에 읽어야 하는 값들 — 콜백은 렌더보다 늦게 돌고, 여기서 낡은
  // 값을 쓰면 미저장 탭이 교체된다.
  const dirtyPathsRef = useRef(dirtyPaths);
  dirtyPathsRef.current = dirtyPaths;
  const previewTabsRef = useRef(true);
  previewTabsRef.current = previewTabs;
  // 창별 줄 점프 지시 — nonce 로 같은 줄의 연속 점프도 다시 발화시킨다.
  // ch/len (UTF-16) 이 있으면 그 범위를 선택한다 (전역 검색의 매치 표시).
  const [jump, setJump] = useState<CodeJump | null>(null);
  const jumpSeq = useRef(0);
  const paneRefs = [useRef<CodePaneHandle>(null), useRef<CodePaneHandle>(null)];

  const selected = focusedPath(tabs);
  const openPaths = useMemo(() => new Set(allOpenPaths(tabs)), [tabs]);

  // 탭 상태는 영속된다 (#tabs-persist). `codeTabs` 는 여기서만 쓰기 때문에
  // 되읽기 루프가 없다 — 초기값으로 한 번 읽고, 이후로는 이쪽이 진실이다.
  useEffect(() => {
    setState((prev) =>
      prev.codeTabs === tabs
        ? prev
        : { ...prev, codeTabs: tabs, codeActivePath: focusedPath(tabs) },
    );
  }, [tabs, setState]);

  const refreshDirtyPaths = useCallback(() => {
    setDirtyPaths(listDirtyPaths(projectId));
  }, [projectId]);

  // ── 열기 ────────────────────────────────────────────────────────────────
  //
  // `preview` 를 켜는 입구는 **트리 단일 클릭 하나뿐**이다 (VS Code 기본과 같다).
  // 팔레트·전역 검색·코드 이동·일지는 전부 고정으로 연다 — 거기는 "훑어본다" 가
  // 아니라 "이걸 하려고 왔다" 는 신호다.
  const openPath = useCallback(
    (
      path: string,
      line: number | null,
      pane?: number,
      sel?: { ch?: number; len?: number; preview?: boolean },
    ) => {
      // 갱신 함수 안에서 setJump 를 부르지 않는다 — StrictMode 는 갱신 함수를 두 번
      // 부르므로 그 안의 부수효과는 두 번 난다. 대신 다음 상태를 밖에서 계산하고,
      // `tabsRef` 를 즉시 앞당겨 같은 틱의 연속 호출도 앞의 결과 위에서 쌓이게 한다.
      const next = openFile(tabsRef.current, path, pane, {
        preview: sel?.preview === true && previewTabsRef.current,
        dirtyPaths: dirtyPathsRef.current,
      });
      tabsRef.current = next;
      setTabs(next);
      if (line != null) {
        jumpSeq.current += 1;
        setJump({ pane: next.focused, line, ch: sel?.ch, len: sel?.len, nonce: jumpSeq.current });
      }
    },
    [],
  );

  /**
   * 지금 보고 있는 파일 안에서만 뛴다 (파일 안 이동의 미리 점프·확정).
   *
   * `openPath` 를 쓰지 않는 이유: 같은 파일이라도 `openFile` 은 매번 새 탭
   * 상태를 만들고, 그 값이 그대로 워크스페이스에 저장된다 — 화살표를 누를
   * 때마다 탭 목록을 다시 쓰게 된다.
   */
  const jumpInFocusedPane = useCallback((line: number, ch?: number, focus = true) => {
    jumpSeq.current += 1;
    setJump({ pane: tabsRef.current.focused, line, ch, focus, nonce: jumpSeq.current });
  }, []);

  // 빠른 열기의 빈 질의 목록 — 보고 있는 파일이 맨 위, 나머지는 탭 순서.
  const openPathsRecent = useMemo(() => {
    const active = tabs.panes[tabs.focused]?.active ?? null;
    const all = allOpenPaths(tabs);
    return active ? [active, ...all.filter((p) => p !== active)] : all;
  }, [tabs]);

  /** 미리보기 탭을 보통 탭으로 — 더블클릭·첫 편집·컨텍스트 메뉴가 부른다. */
  const pinPath = useCallback((pane: number, path: string) => {
    setTabs((prev) => {
      const next = pinTab(prev, pane, path);
      tabsRef.current = next;
      return next;
    });
  }, []);

  return {
    tabs,
    setTabs,
    tabsRef,
    dirtyPaths,
    jump,
    paneRefs,
    selected,
    openPaths,
    refreshDirtyPaths,
    openPath,
    jumpInFocusedPane,
    openPathsRecent,
    pinPath,
  };
}
