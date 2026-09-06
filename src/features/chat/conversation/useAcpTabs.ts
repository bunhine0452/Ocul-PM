// 세션 탭과 이름표 — 취향(`acpTabs`·`acpNames`)에 남는 것들.
//
// `AcpConversation.tsx` 에서 갈라 나온 조각이다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다.
//
// 한 파일에 둔 이유: 전부 **`codex` 에 따라 두 벌 중 하나를 고르는** 같은
// 모양의 코드다(`prev.codexAcpTabs` 대 `prev.acpTabs`). 흩어 놓으면 그 삼항이
// 열 군데로 퍼지고, 한 군데가 어긋나면 Codex 탭이 Claude 목록에 들어간다.

import { useCallback, useEffect, useMemo } from "react";
import type React from "react";

import type { AcpSessionSummary } from "@/lib/bindings";
import { registerCloseHandler } from "@/lib/closeIntent";
import type { UiPrefsSlice, UiPrefsValue } from "@/contexts/WorkspaceContext";

/** 탭 줄 한 칸. `pending` 은 아직 안 만든 새 대화의 자리다. */
export interface AcpTabItem {
  id: string;
  title: string | null;
  pending?: boolean;
}

export interface AcpTabsArgs {
  codex: boolean;
  prefs: UiPrefsSlice;
  setPrefs: UiPrefsValue["setPrefs"];
}

export function useAcpTabs({ codex, prefs, setPrefs }: AcpTabsArgs) {
  /**
   * 사용자가 붙인 이름표. **우리 쪽에만 있다** — 프로토콜에 제목을 고치는
   * 요청이 없어서(있는 것은 지우기뿐) 에이전트의 제목은 그대로 두고 화면에서만
   * 우리 이름이 이긴다. 그래서 이 이름은 이 컴퓨터를 벗어나지 않는다.
   */
  const names = codex ? prefs.codexAcpNames : prefs.acpNames;
  const tabs = codex ? prefs.codexAcpTabs : prefs.acpTabs;

  const nameOf = useCallback(
    (id: string | null, fallback: string | null) => (id ? (names[id] ?? fallback) : fallback),
    [names],
  );
  const withTabs = useCallback(
    (prev: UiPrefsSlice, next: typeof tabs) =>
      codex ? { ...prev, codexAcpTabs: next } : { ...prev, acpTabs: next },
    [codex],
  );
  const withNames = useCallback(
    (prev: UiPrefsSlice, next: typeof names) =>
      codex ? { ...prev, codexAcpNames: next } : { ...prev, acpNames: next },
    [codex],
  );

  /**
   * 탭을 **명시적으로** 연다.
   *
   * 예전에는 "턴이 생겼고 세션이 있으면 등록" 하는 효과로 자동 등록했는데,
   * `session` 이 로드보다 **늦게** 갱신되는 순간이 있다: 다른 대화를 여는
   * 동안 재생분이 먼저 들어와 턴이 차는데 `session` 은 아직 앞 대화다. 그때
   * 방금 닫은 탭이 되살아났다("닫아도 다시 뜨고, 다른 세션을 열면 앞 세션까지
   * 같이 붙는다"). 어느 대화인지 **확실히 아는 두 순간**에만 연다:
   * 말을 걸 때와, 대화를 열어 성공했을 때.
   */
  const addTab = useCallback(
    (id: string | null, title: string | null) => {
      if (!id) return;
      setPrefs((prev) =>
        (codex ? prev.codexAcpTabs : prev.acpTabs).some((tab) => tab.id === id)
          ? prev
          : withTabs(prev, [...(codex ? prev.codexAcpTabs : prev.acpTabs), { id, title }]),
      );
    },
    [codex, setPrefs, withTabs],
  );

  /** 제목만 갱신 — **없는 탭을 만들지 않는다**(그게 되살아남의 통로였다). */
  const renameTab = useCallback(
    (id: string | null, title: string | null) => {
      if (!id || title === null) return;
      setPrefs((prev) => {
        const current = codex ? prev.codexAcpTabs : prev.acpTabs;
        const at = current.findIndex((tab) => tab.id === id);
        if (at === -1 || current[at].title === title) return prev;
        const next = [...current];
        next[at] = { id, title };
        return withTabs(prev, next);
      });
    },
    [codex, setPrefs, withTabs],
  );

  /** 열려 있는 탭의 제목 — 대화를 다시 고를 때 어댑터에 같이 넘긴다. */
  const tabTitleOf = useCallback(
    (id: string) => tabs.find((tab) => tab.id === id)?.title ?? null,
    [tabs],
  );

  /** 목록의 제목으로 탭을 메운다 (이름표를 붙인 탭은 건드리지 않는다 — 그쪽이 이긴다). */
  const applyTitlesToTabs = useCallback(
    (items: AcpSessionSummary[]) => {
      setPrefs((prev) => {
        let changed = false;
        const current = codex ? prev.codexAcpTabs : prev.acpTabs;
        const next = current.map((tab) => {
          const found = items.find((item) => item.id === tab.id);
          if (!found?.title || found.title === tab.title) return tab;
          changed = true;
          return { ...tab, title: found.title };
        });
        return changed ? withTabs(prev, next) : prev;
      });
    },
    [codex, setPrefs, withTabs],
  );

  /** 탭만 뗀다 (대화는 그대로). */
  const forgetTab = useCallback(
    (id: string) => {
      setPrefs((prev) =>
        withTabs(prev, (codex ? prev.codexAcpTabs : prev.acpTabs).filter((tab) => tab.id !== id)),
      );
    },
    [codex, setPrefs, withTabs],
  );

  /** 지운 대화의 탭과 이름표를 함께 치운다 (안 치우면 열 수 없는 탭이 남는다). */
  const forgetSession = useCallback(
    (id: string) => {
      setPrefs((prev) => {
        const next = { ...(codex ? prev.codexAcpNames : prev.acpNames) };
        delete next[id];
        return withNames(
          withTabs(prev, (codex ? prev.codexAcpTabs : prev.acpTabs).filter((tab) => tab.id !== id)),
          next,
        );
      });
    },
    [codex, setPrefs, withNames, withTabs],
  );

  /**
   * 이름표를 붙인다(빈 문자열이면 뗀다). 에이전트에게는 보내지 않는다 —
   * 프로토콜에 제목을 고치는 요청이 없다.
   */
  const rename = useCallback(
    (sessionId: string, next: string) => {
      const label = next.trim();
      setPrefs((prev) => {
        const current = { ...(codex ? prev.codexAcpNames : prev.acpNames) };
        if (label) current[sessionId] = label;
        else delete current[sessionId];
        return withNames(prev, current);
      });
    },
    [codex, setPrefs, withNames],
  );

  return {
    names,
    tabs,
    nameOf,
    addTab,
    renameTab,
    tabTitleOf,
    applyTitlesToTabs,
    forgetTab,
    forgetSession,
    rename,
  };
}

export interface AcpTabCloseArgs {
  /** 아직 안 만든 새 대화의 자리 표시 (`session_id === ""`). */
  slate: string;
  tabs: readonly { id: string; title: string | null }[];
  forgetTab: (id: string) => void;
  currentSessionId: string | null;
  /** 어댑터는 붙었는데 대화는 아직 안 만든 상태. */
  pending: boolean;
  /** 이 화면이 실제로 보이는지 판정할 뿌리 (⌘W 사슬이 읽는다). */
  rootRef: React.RefObject<HTMLDivElement | null>;
  openSession: (sessionId: string) => Promise<void>;
  newConversation: () => void;
}

/**
 * 탭을 닫는다. **보고 있던 탭이면 다른 탭으로 옮겨 간다** — 안 그러면 탭은
 * 없는데 그 대화가 화면에 그대로 남고, 그 상태에서 말을 걸면 방금 닫은 탭이
 * 되살아난다("닫아도 안 닫힌다"의 정체). ⌘W 도 같은 길을 탄다.
 */
export function useAcpTabClose({
  slate,
  tabs,
  forgetTab,
  currentSessionId,
  pending,
  rootRef,
  openSession,
  newConversation,
}: AcpTabCloseArgs) {
  const closeTab = useCallback(
    (id: string) => {
      // 아직 안 만든 대화는 `acpTabs` 에 없다 — 닫는다는 것은 곧 하던 대화로
      // 돌아가는 것이다. (돌아갈 곳이 없으면 닫기 버튼 자체가 안 뜬다.)
      if (id === slate) {
        if (tabs.length) void openSession(tabs[tabs.length - 1].id);
        return;
      }
      forgetTab(id);
      if (currentSessionId !== id) return;
      const rest = tabs.filter((tab) => tab.id !== id);
      if (rest.length) void openSession(rest[rest.length - 1].id);
      else newConversation();
    },
    [slate, tabs, forgetTab, currentSessionId, openSession, newConversation],
  );

  /**
   * ⌘W — 세션 탭을 **먼저** 닫는다.
   *
   * 브라우저와 같은 기대다: 안쪽에 열어 둔 것이 있으면 그것부터. 여기서 받지
   * 않으면(열어 둔 대화가 없으면) 창 쪽이 프로젝트 탭을 닫는다.
   */
  useEffect(
    () =>
      registerCloseHandler(() => {
        // **안 보이는 화면은 받지 않는다.** 프로젝트 탭은 배경에서도 마운트된
        // 채 남으므로(Chrome 처럼 watcher·PTY 가 계속 돈다) 창에 Claude Code
        // 화면이 둘 이상 살아 있을 수 있다. 사슬은 나중에 등록한 것부터 묻는데
        // 그게 배경 탭이면, 보이는 화면은 그대로인 채 남의 세션 탭이 닫힌다
        // ("⌘W 해도 안 사라질 때가 있다"의 정체).
        //
        // display:none 안의 요소는 레이아웃 상자가 없다 — 그것으로 가른다.
        if (!rootRef.current?.getClientRects().length) return false;
        // 아직 안 만든 대화도 닫는다 — 돌아갈 대화가 있을 때만(빈 화면 하나만
        // 남기고 창을 붙잡고 있으면 ⌘W 가 영영 안 먹는 것처럼 보인다).
        if (!currentSessionId) {
          if (!pending || !tabs.length) return false;
          closeTab(slate);
          return true;
        }
        if (!tabs.some((tab) => tab.id === currentSessionId)) return false;
        closeTab(currentSessionId);
        return true;
      }),
    [slate, currentSessionId, pending, tabs, closeTab, rootRef],
  );

  return closeTab;
}

/**
 * 탭 줄에 실제로 서는 칸들.
 *
 * **새 세션을 누르면 탭 줄에도 그 자리가 생긴다.** 세션은 첫 마디를 보낼 때
 * 비로소 만들어지는데(`newConversation` 은 화면만 비운다), 탭 줄은 `acpTabs`
 * 만 그렸으니 눌러도 상단바는 방금 떠나온 대화를 가리키고 있었다.
 *
 * `acpTabs` 에 넣지 않고 **여기서만 붙인다**: 그 목록은 디스크에 남는데, 아직
 * 아무것도 아닌 대화가 거기 남으면 다음에 앱을 켰을 때 열 수 없는 탭이 하나
 * 뜬다. 첫 마디와 함께 진짜 탭이 같은 자리(맨 끝)에 들어선다.
 */
export function useAcpTabItems(
  tabs: readonly { id: string; title: string | null }[],
  nameOf: (id: string | null, fallback: string | null) => string | null,
  pending: boolean,
  slate: string,
): AcpTabItem[] {
  return useMemo(() => {
    const named = tabs.map((tab) => ({ ...tab, title: nameOf(tab.id, tab.title) }));
    return pending ? [...named, { id: slate, title: null, pending: true }] : named;
  }, [tabs, nameOf, pending, slate]);
}
