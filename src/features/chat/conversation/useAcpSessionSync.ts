// 세션 목록·되읽기·열기·다시 연결 — 이 화면이 어댑터와 맞추는 모든 것.
//
// `AcpConversation.tsx` 에서 갈라 나온 조각이다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다.
//
// 한 훅으로 묶은 이유: 넷이 **같은 세대 표**(`loadSeqRef`)와 같은 원장
// (`activityRef`·`removedRef`)을 본다. 흩어 놓으면 "지난 로드의 재생분"을
// 거르는 규칙이 여러 곳에 복사되고, 그 복사본 하나가 어긋나는 날 두 대화가
// 한 화면에 섞인다 — 실제로 겪은 사고다.

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { Channel } from "@tauri-apps/api/core";

import {
  commands,
  events,
  type AcpEvent,
  type AcpSession,
  type AcpSessionSummary,
} from "@/lib/bindings";
import { createUnlistenBag } from "@/lib/unlisten";
import { tError } from "@/i18n/errors";
import { applyAcpEvent, closeTurn, type AcpTurn } from "../acpTurns";
import { stabilizeHistory, type ActivityLedger } from "../acpHistory";
import { resolveTitle } from "../acpTitle";
import { sameOptions } from "../acpOptions";
import type { PermissionState } from "./shared";
import type { UsageState } from "./useSessionMaps";

/**
 * 지난 대화 **목록의 내용**을 바꾸는 사건들.
 *
 * 목록 조회는 어댑터로 나가는 진짜 왕복이라 아무 알림에나 달면 안 된다 —
 * 특히 `usage` 는 턴이 도는 동안 계속 온다. 줄이 생기거나(created) 사라지거나
 * (deleted) 이름이 붙는(title) 때만 다시 읽는다.
 */
const HISTORY_KINDS: ReadonlySet<string> = new Set(["created", "deleted", "title"]);

export interface AcpSessionSyncArgs {
  projectId: number;
  provider: "claude" | "codex";
  session: AcpSession | null;
  setSession: React.Dispatch<React.SetStateAction<AcpSession | null>>;
  /** 최신 `session` — 비동기 콜백이 읽는 자리 (의존성 고리를 만들지 않으려고). */
  sessionRef: React.RefObject<AcpSession | null>;
  /** 이 화면이 지금 눈에 보이는가 — 안 보이면 되읽지 않는다. */
  isVisible: () => boolean;
  /** 이 대화에 우리가 보낸 지시들 (제목의 메아리를 거르는 재료). */
  promptsOf: (id: string) => string[];
  activityRef: React.RefObject<ActivityLedger>;
  removedRef: React.RefObject<Set<string>>;
  loadSeqRef: React.RefObject<number>;
  transcriptsRef: React.RefObject<Record<string, AcpTurn[]>>;
  setTranscripts: React.Dispatch<React.SetStateAction<Record<string, AcpTurn[]>>>;
  editTurns: (id: string, update: (prev: AcpTurn[]) => AcpTurn[]) => void;
  putError: (id: string, message: string | null) => void;
  putUsage: (id: string, usage: UsageState | null) => void;
  putPermission: (id: string, value: PermissionState | null) => void;
  setError: (message: string | null) => void;
  setStarting: React.Dispatch<React.SetStateAction<boolean>>;
  setAgentGone: React.Dispatch<React.SetStateAction<boolean>>;
  /** 살아 있는 것을 한 번이라도 봤는가 — "죽었다"는 살아 있던 것만 말할 수 있다. */
  aliveRef: React.RefObject<boolean>;
  addTab: (id: string | null, title: string | null) => void;
  /** 열려 있는 탭의 제목 (이름표가 붙었으면 그것). */
  tabTitleOf: (id: string) => string | null;
  /** 목록의 제목으로 탭을 메운다 (이름표를 붙인 탭은 건드리지 않는다). */
  applyTitlesToTabs: (items: AcpSessionSummary[]) => void;
  /** 다시 띄운 뒤 돌아갈 대화 (취향에 적힌 마지막 대화). */
  lastSessionId: string | null;
  /** "이제부터 바닥이 관심사다" (`useThreadScroll`). */
  followBottom: () => void;
}

export function useAcpSessionSync({
  projectId,
  provider,
  session,
  setSession,
  sessionRef,
  isVisible,
  promptsOf,
  activityRef,
  removedRef,
  loadSeqRef,
  transcriptsRef,
  setTranscripts,
  editTurns,
  putError,
  putUsage,
  putPermission,
  setError,
  setStarting,
  setAgentGone,
  aliveRef,
  addTab,
  tabTitleOf,
  applyTitlesToTabs,
  lastSessionId,
  followBottom,
}: AcpSessionSyncArgs) {
  /** 과거 대화 목록. `null` 이면 아직 안 불러온 상태. */
  const [history, setHistory] = useState<AcpSessionSummary[] | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  /** 어댑터에 붙었는가 — 되읽기 구독을 걸지 말지의 유일한 근거다. */
  const hasSession = session != null;
  /**
   * 대화 목록을 다시 읽는다. **실패해도 조용하다** — 이 조회는 사용자가 시킨
   * 것이 아니라 탭 제목을 채우려고 세션이 붙을 때마다 우리가 도는 것이라,
   * 실패를 대화창에 띄우면 아무 것도 안 했는데 빨간 줄이 뜬다. 목록이 비면
   * 패널이 자기 빈 상태를 보여 준다.
   */
  const refreshHistory = useCallback(async () => {
    const res = await commands.acpListSessions(projectId, provider);
    if (res.status === "ok") {
      // 목록의 제목도 어댑터가 준 그대로다 — 탭과 같은 잣대로 거른다. 안 그러면
      // 같은 대화가 탭에서는 제 이름으로, 옆 패널에서는 방금 친 말로 보인다.
      const stable = stabilizeHistory(res.data, activityRef.current, removedRef.current);
      setHistory(
        stable.map((item) => ({ ...item, title: resolveTitle(item.title, promptsOf(item.id)) })),
      );
      // 정렬(활성 먼저)은 여기서 하지 않는다 — 조회는 몇 초에 한 번이고 활성
      // 여부는 그 사이에도 바뀐다. 렌더 시점에 접는다.

    }
  }, [projectId, provider, promptsOf, activityRef, removedRef]);

  /**
   * 설정·제목·어댑터 생사를 **백엔드가 알려 줄 때** 되읽는다.
   *
   * 모델을 바꾸면 어댑터가 **권한 모드를 조용히 내릴 수 있다**(새 모델이 그
   * 모드를 지원하지 않을 때). 그 사실은 우리 요청의 응답이 아니라 알림으로
   * 오므로, 되읽지 않으면 "Auto" 라 적힌 채 실제로는 Manual 로 도는 상태가
   * 된다 — 사용자가 자동 승인될 거라 믿는 순간이라 그냥 두면 안 된다.
   */
  useEffect(() => {
    if (!hasSession) return;
    const sync = () => {
      // 안 보이는 동안에는 되읽지 않는다 — 이 값들은 **화면에만** 쓰이고,
      // 화면이 keep-alive 로 살아 있는 한 이 구독도 계속 산다. 돌아오면
      // 깨어남 신호가 알아서 따라잡는다.
      if (!isVisible()) return;
      // 어댑터 생사부터 본다. 다른 조회는 백엔드 상태의 **로컬 읽기**라
      // 프로세스가 죽어도 마지막 값을 돌려준다 — 죽음이 화면에 안 보였다.
      void commands.acpStatus(projectId, provider).then((res) => {
        if (res.status !== "ok") return;
        if (res.data) {
          aliveRef.current = true;
          setAgentGone(false);
        } else if (aliveRef.current) {
          aliveRef.current = false;
          setAgentGone(true);
        }
      });
      void commands.acpOptions(projectId, provider).then((res) => {
        if (res.status !== "ok" || !res.data.length) return;
        // **달라졌을 때만** 갈아 끼운다 (사연은 acpOptions.ts 에). 같은 값을
        // 새 객체로 넣으면 이 효과가 스스로를 다시 불러 끝없이 돈다.
        setSession((prev) =>
          prev && !sameOptions(prev.options, res.data) ? { ...prev, options: res.data } : prev,
        );
      });
      // 제목은 에이전트가 대화를 보고 **나중에** 붙인다 — 알림을 따라간다.
      // 아직 안 만든 새 대화(`session_id === null`)에서는 건너뛴다: 백엔드에는
      // 직전 대화가 남아 있어서 그 제목이 빈 화면에 되살아난다.
      //
      // 최신값은 ref 로 읽는다 — `session` 을 의존성에 넣으면 위와 같은 고리가
      // 다시 생기고, 제목이 하나 바뀔 때마다 구독을 새로 걸기까지 한다.
      if (sessionRef.current?.session_id == null) return;
      void commands.acpSessionTitle(projectId, provider).then((res) => {
        if (res.status === "ok") {
          setSession((prev) =>
            prev && prev.title !== res.data ? { ...prev, title: res.data } : prev,
          );
        }
      });
    };
    // Phase 4 #events-over-polling — 4초 폴링 대신 백엔드의 세션 변화 이벤트
    // (어댑터 생사·제목·설정·대화 목록). 창이 깨어날 때 한 번 더 맞춘다.
    sync();
    // 구독이 **붙기 전에** 이 화면을 떠날 수 있다 — 자루가 그때 도착한 리스너를
    // 그 자리에서 뗀다 (안 그러면 죽은 화면이 이벤트마다 IPC 를 한 벌 더 쏜다).
    const bag = createUnlistenBag();
    bag.add(
      events.acpSessionChanged.listen((evt) => {
        if (evt.payload.project_id !== projectId || evt.payload.provider !== provider) return;
        sync();
        // 목록의 **내용**이 바뀌는 종류만 다시 읽는다. 뒤에서 도는 대화의
        // 제목은 이 길로만 탭에 닿는다 — 제목은 이제 그 대화의 칸에 들어가서
        // 보고 있는 화면의 상태(`session.title`)로는 오지 않는다.
        if (HISTORY_KINDS.has(evt.payload.kind)) void refreshHistory();
      }),
    );
    const onWake = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      bag.dispose();
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [projectId, provider, hasSession, isVisible, refreshHistory, sessionRef, setSession, aliveRef, setAgentGone]);

  // 패널을 안 열어도 목록을 읽는다. **탭 제목이 여기서 온다** — 세션 제목은
  // 에이전트가 대화를 보고 붙이고 그 알림은 만든 직후 한 번뿐이라, 지난 대화를
  // 열면 알림이 다시 오지 않아 탭이 영영 "제목 없는 대화"로 남았다. 목록은
  // 어댑터가 들고 있는 **완성된 제목**을 언제든 준다.
  useEffect(() => {
    if (!hasSession) return;
    void refreshHistory();
    // `session` 객체가 아니라 **어느 대화인가**에 걸린다 — 객체를 잡으면 제목·
    // 설정이 바뀔 때마다 어댑터로 목록 조회가 한 번씩 더 나간다.
  }, [hasSession, session?.session_id, refreshHistory]);

  // 목록의 제목으로 탭을 메운다 (이름표를 붙인 탭은 건드리지 않는다 — 그쪽이 이긴다).
  useEffect(() => {
    if (history?.length) applyTitlesToTabs(history);
  }, [history, applyTitlesToTabs]);

  const openSession = useCallback(
    async (sessionId: string) => {
      // 이 화면이 지금 무엇을 그리고 있는지의 **세대**. 탭을 빠르게 두 번 누르면
      // load 가 두 개 뜨는데, 백엔드의 이벤트 싱크는 프로젝트당 하나라 나중
      // 것이 앞 것을 밀어낸다 — 그런데 앞 로드의 재생분은 이미 흐르고 있어서
      // 두 대화가 한 화면에 섞였다("클릭하지 않은 세션이 보인다", 그리고 같은
      // 도구 카드가 두 번 그려지며 React 가 key 중복을 외쳤다).
      //
      // 지난 세대의 이벤트와 응답은 통째로 버린다.
      const seq = ++loadSeqRef.current;
      // 다른 대화를 열면 그 대화의 **끝**부터 본다 — 앞 대화에서 위로 올려 두었던
      // 것이 새 대화의 스크롤 정책으로 새어 나가면 안 된다.
      followBottom();

      // 이미 이 창에서 본 대화면 **다시 읽지 않는다.**
      //
      // 우리 기록이 디스크보다 최신이다 — 아직 흐르고 있는 답은 디스크에 없다.
      // `session/load` 로 갈아타면 그 답을 놓칠 뿐 아니라, 그 대화에 물려 있는
      // 스트림의 자리를 잠깐 빼앗아 아예 멎게 만든다. 장부만 바꾼다.
      if (transcriptsRef.current[sessionId]?.length) {
        const title = tabTitleOf(sessionId);
        const picked = await commands.acpSelectSession(projectId, provider, sessionId, title);
        if (loadSeqRef.current !== seq) return;
        if (picked.status === "ok") setSession(picked.data);
        else putError(sessionId, tError(picked.error));
        return;
      }

      editTurns(sessionId, () => []);
      // 다시 읽는 **그 대화의 것만** 지운다 — 재생이 지난 상태를 덮어쓰기
      // 때문이다(백엔드도 이 대화의 승인 카드만 취소로 닫는다). 옆 대화가 들고
      // 있는 카드·사용량은 그대로 둔다.
      putUsage(sessionId, null);
      putPermission(sessionId, null);
      putError(sessionId, null);

      // `session/load` 는 지난 대화를 session/update 로 **되흘려보낸다**.
      // 그 이벤트를 replay 모드로 리듀서에 먹여 화면을 복원한다.
      const channel = new Channel<AcpEvent>();
      channel.onmessage = (event) => {
        if (loadSeqRef.current !== seq) return;
        editTurns(sessionId, (prev) => applyAcpEvent(prev, event, true));
      };

      const res = await commands.acpLoadSession(projectId, provider, sessionId, channel);
      if (loadSeqRef.current !== seq) return;
      if (res.status === "ok") {
        setSession(res.data);
        addTab(sessionId, res.data.title);
        // 재생이 끝났으니 마지막 턴을 닫는다 — 안 닫으면 다음 질문의 답이
        // 지난 답변 꼬리에 붙는다.
        editTurns(sessionId, closeTurn);
      } else {
        putError(sessionId, tError(res.error));
      }
    },
    [
      projectId, provider, addTab, editTurns, tabTitleOf, putUsage, putPermission,
      putError, loadSeqRef, transcriptsRef, followBottom, setSession,
    ],
  );


  /**
   * 죽은 어댑터를 다시 띄우고 **보던 대화로 돌아간다.**
   *
   * 새 프로세스는 지난 대화를 모른다 — 우리 화면에 기록이 남아 있어도
   * `session/load` 로 어댑터에 다시 실어야 이어서 말을 걸 수 있다. 그래서
   * 메모리 기록을 비우고 로드 경로를 강제한다 (안 비우면 openSession 이
   * "이미 본 대화" 지름길을 타서 어댑터는 여전히 모르는 채가 된다).
   */
  const reconnect = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await commands.acpStart(projectId, provider);
      if (res.status !== "ok") {
        setError(tError(res.error));
        return;
      }
      aliveRef.current = true;
      setAgentGone(false);
      const previous = session?.session_id ?? null;
      setSession(res.data);
      await refreshHistory();
      if (previous) {
        setTranscripts((prev) => ({ ...prev, [previous]: [] }));
        transcriptsRef.current = { ...transcriptsRef.current, [previous]: [] };
        await openSession(previous);
      }
    } finally {
      setStarting(false);
    }
  }, [
    projectId, provider, session?.session_id, refreshHistory, openSession, setSession,
    setError, setStarting, setAgentGone, aliveRef, setTranscripts, transcriptsRef,
  ]);

  /**
   * 다시 띄운 뒤 **하던 대화로 돌아간다** (업데이트 재시작이 이 길을 탄다).
   *
   * 어댑터는 새 프로세스라 대화가 없지만 대화 자체는 디스크에 남아 있다. 목록에
   * 그 id 가 아직 있으면 도로 연다. 이미 지웠거나 없으면 조용히 빈 화면 — 없는
   * 대화를 열려다 오류를 띄우는 것보다 낫다.
   *
   * **한 번만** 시도한다: 사용자가 그 뒤로 다른 대화를 골랐는데 이게 다시 끼어들면
   * 화면이 제 마음대로 움직이는 것처럼 보인다.
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !session || !history) return;
    restoredRef.current = true;
    const last = lastSessionId;
    if (!last || last === session.session_id) return;
    if (!history.some((item) => item.id === last)) return;
    void openSession(last);
  }, [session, history, lastSessionId, openSession]);


  return { history, historyQuery, setHistoryQuery, refreshHistory, openSession, reconnect };
}
