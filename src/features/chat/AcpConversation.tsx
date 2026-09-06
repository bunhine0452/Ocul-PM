import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "@/components/Icons";
import { AgentGoneNotice, JournalGateNotice, RecordingNotice } from "./RecordingNotice";
import { commands, type AcpSession, type AcpSessionSummary } from "@/lib/bindings";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { reportFailure } from "@/lib/reportFailure";
import { useEscCancel } from "./useEscCancel";
import { useUiPrefs, useProjectRuntime, useTerminalSessions } from "@/contexts/WorkspaceContext";
import { useSessionMaps } from "./conversation/useSessionMaps";
import { type PermissionState } from "./conversation/shared";
import { TurnRow } from "./conversation/TurnRow";
import { PermissionCard } from "./conversation/PermissionCard";
import { SessionPanel } from "./conversation/SessionPanel";
import { Composer } from "./conversation/Composer";
import { AcpOffPanel, AcpReadyPanel } from "./conversation/StartPanels";
import { useThreadScroll } from "./conversation/useThreadScroll";
import { useComposerKeys } from "./conversation/useComposerKeys";
import { useAcpSend } from "./conversation/useAcpSend";
import { useComposerSuggest } from "./conversation/useComposerSuggest";
import { useComposerAttachments } from "./conversation/useComposerAttachments";
import { useAcpSessionSync } from "./conversation/useAcpSessionSync";
import { useAcpTabs, useAcpTabClose, useAcpTabItems } from "./conversation/useAcpTabs";
import { AcpErrorCard, AcpToolbar } from "./conversation/AcpToolbar";
import { useAcpAdapter } from "./conversation/useAcpAdapter";
import { useAcpSignals } from "./conversation/useAcpSignals";
import { groupTurns, type AcpTurn } from "./acpTurns";
import { requestUsagePanel } from "./usageBus";
import { acpRowSourceOf, acpRowStateOf, useAcpRowStates } from "./acpBusyBus";
import { type RecallState } from "./promptHistory";
import { sortActiveFirst, type ActivityLedger } from "./acpHistory";
import {
  claudeCommand,
  codexCommand,
  newPtySessionId,
  stageBootCommand,
} from "@/features/terminal/terminalLaunch";

/** 아직 안 만든 새 대화의 기록이 머무는 자리 (`session_id` 가 아직 없다). */
const SLATE = "";

/** 빈 기록의 **한 개짜리** 배열 — 매 렌더 새 배열을 만들면 memo 가 다 깨진다. */
const EMPTY_TURNS: AcpTurn[] = [];

/** 같은 이유의 빈 목록 (아직 대화 목록을 못 읽었을 때). */
const EMPTY_SESSIONS: AcpSessionSummary[] = [];

// PR-ACP2~5 — ACP 대화면 (docs/acp-panel/00-master-plan.md §5).
//
// 프로바이더 채팅(AiPanelScreenV2 본체)과 **상태를 공유하지 않는다.** 저쪽은
// 우리가 히스토리를 들고 매번 통째로 재전송하지만, ACP 는 세션이 에이전트 쪽에
// 살아 있어 우리는 화면에 그릴 것만 들고 있으면 된다.
//
// 화면의 성격도 다르다: 채팅이 아니라 **작업 콘솔**이다. 사람의 말과 기계의
// 행적(도구 호출·승인)이 한 흐름에 섞이므로, 산문은 크게 읽히고 행적은 왼쪽
// 헤어라인에 묶여 눌린다 (agent.css `.trace`).


export type AcpProvider = "claude" | "codex";

export function AcpConversation({
  projectId,
  provider = "claude",
}: {
  projectId: number;
  provider?: AcpProvider;
}) {
  const { t } = useT();
  const codex = provider === "codex";
  // Phase 4 #workspace-split — 취향(acp*)·런타임(프로젝트)·터미널(「터미널에서」) 조각.
  const { prefs, setPrefs } = useUiPrefs();
  const runtime = useProjectRuntime();
  const { openTab } = useTerminalSessions();
  const panelOpen = prefs.acpPanelOpen;
  const ultracode = codex ? false : prefs.acpUltracode;
  /** 탭 줄과 이름표(취향에 남는 것들)는 조각 훅이 소유한다. */
  const {
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
  } = useAcpTabs({ codex, prefs, setPrefs });

  const [session, setSession] = useState<AcpSession | null>(null);
  /**
   * 최신 `session` — **비동기 콜백이 읽는 자리**.
   *
   * 되읽기 효과가 `session` 자체를 의존성으로 잡고 있었고, 그 안에서 새
   * 객체로 상태를 갈아 끼웠다. 그래서 효과가 자기를 다시 부르는 고리가 생겨
   * `acp_status`·`acp_options`·`acp_session_title`·`acp_list_sessions` 가
   * 화면이 보이는 내내 초당 수천 번씩 나갔다 (마지막 것은 어댑터로 나가는
   * 진짜 왕복이라 Claude Code 프로세스까지 함께 두들겼다).
   */
  const sessionRef = useRef<AcpSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  /**
   * 대화별 기록. **화면이 아니라 대화가 턴을 소유한다.**
   *
   * 예전엔 화면이 `turns` 하나를 들고 있어서, 답변 도중 다른 대화로 넘어가면
   * 흐르던 글자가 **그 대화 화면에 쓰였다**. 반대로 돌아오면 `session/load` 가
   * 디스크에서 다시 읽는데 아직 안 끝난 답은 디스크에 없어 통째로 사라졌다.
   * 대화 id 로 갈라 두면 둘 다 저절로 없어진다 — 스트리밍은 자기 대화에
   * 계속 쌓이고, 돌아오면 그 자리에 그대로 있다.
   */
  const [transcripts, setTranscripts] = useState<Record<string, AcpTurn[]>>({});
  const editTurns = useCallback(
    (id: string, update: (prev: AcpTurn[]) => AcpTurn[]) => {
      setTranscripts((prev) => {
        const before = prev[id] ?? EMPTY_TURNS;
        const after = update(before);
        // 리듀서가 **같은 배열**을 돌려주면 아무 일도 없었던 것이다 — 그때
        // 새 지도를 만들면 화면 전체가 다시 그려진다(그리고 아무 것도 안
        // 바뀐다). 버려지는 이벤트가 흔한 자리라 이 검사가 값을 한다.
        return after === before ? prev : { ...prev, [id]: after };
      });
    },
    [],
  );
  /**
   * 같은 값의 **읽기 전용 사본**.
   *
   * `openSession` 이 "이미 본 대화인가"를 판단하려고 `transcripts` 를 읽는데,
   * 의존성에 넣으면 **글자 한 덩어리 올 때마다** openSession 이 새로 만들어진다.
   * 그 아이덴티티는 `send` → 큐 배출 effect → 툴바 탭까지 줄줄이 타고 흘러서,
   * 스트리밍 중 초당 수십 번 헛도는 일감이 됐다. 판단에는 최신값만 있으면 된다.
   */
  const transcriptsRef = useRef(transcripts);
  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);
  /**
   * 이 대화에 **우리가 보낸 지시문**, 보낸 순서대로.
   *
   * 제목을 거르는 데 쓴다 (acpTitle.ts): 어댑터가 주는 제목은 AI 가 진짜 제목을
   * 붙이기 전까지 **마지막 지시문**이라, 대화를 이어 갈수록 탭이 방금 친 말로
   * 계속 바뀌었다. 무엇을 보냈는지 알면 그 메아리를 가려낼 수 있다.
   *
   * 기록에서 바로 읽는다 — 따로 장부를 두면 지난 대화를 다시 열었을 때(재생분
   * 으로만 채워지는 경우) 그 장부가 비어 있다. **효과 안에서만** 부른다:
   * `transcriptsRef` 는 렌더가 아니라 커밋 뒤에 최신이 된다.
   */
  const promptsOf = useCallback(
    (id: string): string[] =>
      (transcriptsRef.current[id] ?? [])
        .filter((turn) => turn.role === "user")
        .map((turn) => turn.text),
    [],
  );
  const activeId = session?.session_id ?? SLATE;
  /** 어댑터는 붙었는데 대화는 아직 안 만든 상태 — 곧 "새 세션을 누른 직후". */
  const pending = session != null && session.session_id == null;
  const turns = transcripts[activeId] ?? EMPTY_TURNS;
  /**
   * 묶음 나누기는 렌더마다 하지 않는다 — 스트리밍 중에는 초당 수십 번 렌더되고,
   * 그때마다 전체 기록을 다시 훑어 새 배열을 만들면 아래의 `TurnRow` memo 도
   * 통째로 무의미해진다 (props 배열이 매번 새 객체라서).
   */
  const groups = useMemo(() => groupTurns(turns), [turns]);
  /** 이 대화에서 보낸 지시들 — ↑ 되부르기의 원장. */
  const userPrompts = useMemo(
    () => turns.filter((turn) => turn.role === "user").map((turn) => turn.text),
    [turns],
  );
  const [draft, setDraft] = useState("");
  /** 대화별로 갈라 두는 것들 — 사연과 구현은 `conversation/useSessionMaps` 에 있다. */
  const {
    busySessions,
    permissions,
    busy,
    error,
    usage,
    permission,
    markBusy,
    putError,
    putUsage,
    putPermission,
  } = useSessionMaps(activeId);

  /**
   * 지금 보고 있는 대화 — 비동기 콜백이 "그때 화면이 어디였나"를 묻는 자리.
   * (렌더 중에 쓰지 않는다. 커밋된 뒤의 값만 읽는다.)
   */
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  /**
   * 보고 있는 대화에 붙이는 것들. 화면 곳곳의 호출부는 예전 이름 그대로 쓴다.
   *
   * **턴 안에서는 쓰지 않는다** — 답이 흐르는 동안 사용자가 탭을 옮기면 남의
   * 대화에 적히기 때문이다. `send` 는 자기가 향한 대화를 직접 짚는다.
   */
  const setError = useCallback(
    (message: string | null) => putError(activeIdRef.current, message),
    [putError],
  );
  const setPermission = useCallback(
    (value: PermissionState | null) => putPermission(activeIdRef.current, value),
    [putPermission],
  );

  /** 어댑터 붙이기(자동 시작·재시도·설치)와 생사 판정은 조각 훅이 소유한다. */
  const {
    starting,
    setStarting,
    needsInstall,
    agentGone,
    setAgentGone,
    aliveRef,
    retry,
    installAdapter,
    setOption,
  } = useAcpAdapter({ projectId, provider, setSession, setError });

  /** 지금 화면이 그리는 대화의 세대 — 지난 로드의 재생분을 걸러 내는 표. */
  const loadSeqRef = useRef(0);
  /**
   * 목록 순서를 잡아 두는 원장 — 어댑터의 `updated_at` 은 대화를 **열기만 해도**
   * 올라가서, 그대로 쓰면 "최근에 이야기한 순서"가 "눌러 본 순서"가 된다.
   */
  const activityRef = useRef<ActivityLedger>(new Map());
  /** 우리가 지운 대화 — 어댑터 목록이 따라오기 전까지 다시 보이지 않게. */
  const removedRef = useRef<Set<string>>(new Set());

  /** 이 화면이 실제로 보이는지 판정할 뿌리 (⌘W 사슬이 읽는다). */
  const rootRef = useRef<HTMLDivElement | null>(null);
  /**
   * 지금 눈에 보이는가.
   *
   * 이 화면은 **다른 화면으로 옮겨도 마운트된 채 남는다** (ShellV2 의 keep-alive
   * — 안 그러면 돌던 턴이 화면과 함께 죽는다). 그래서 "보이는가"와 "살아 있는가"
   * 가 갈라졌고, 문서 전역에 거는 것들(ESC)과 주기 조회는 **보일 때만** 자기
   * 일을 해야 한다. display:none 안의 요소는 레이아웃 상자가 없다 — ⌘W 사슬이
   * 쓰던 것과 같은 잣대다.
   */
  const isVisible = useCallback(() => !!rootRef.current?.getClientRects().length, []);
  /** 컴포저의 입력창 — 자동완성·붙임·드롭이 함께 커서를 돌려보낸다. */
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** 컴포저에 얹는 것들(고르기·드롭·붙여넣기)은 조각 훅이 소유한다. */
  const {
    attachments,
    setAttachments,
    addAttachments,
    images,
    setImages,
    dropActive,
    attach,
    onPaste,
  } = useComposerAttachments({
    projectId,
    projectRoot: runtime.currentProjectRoot,
    isVisible,
    inputRef,
    supportsImage: useCallback(() => sessionRef.current?.agent.supports_image === true, []),
    setError,
    unsupportedMessage: t("acp.imagesUnsupported"),
  });
  const addAttachment = useCallback(
    (relPath: string) => addAttachments([relPath]),
    [addAttachments],
  );
  /** 자동완성(`@`·`/`)과 입력창 자동 높이는 조각 훅이 소유한다. */
  const {
    mentions,
    setMentions,
    mentionIndex,
    setMentionIndex,
    pickMention,
    slash,
    setSlash,
    slashIndex,
    setSlashIndex,
    pickCommand,
  } = useComposerSuggest({ projectId, provider, codex, draft, setDraft, inputRef, addAttachment });

  /**
   * **그 대화가** 도는 동안 사용자가 친 메시지. 턴이 끝나면 차례로 나간다.
   * (옆 대화가 도는 것은 상관없다 — 그쪽은 그쪽대로 간다.)
   *
   * 클라이언트에서 줄 세우는 이유: 어댑터가 `promptQueueing` 을 광고하긴
   * 하지만, 그쪽에 맡기면 큐가 **화면에 안 보이고 취소도 못 한다**. 여기서
   * 들고 있으면 대기 중인 문장을 보여 주고 빼낼 수 있다.
   *
   * **어느 대화의 것인지 함께 든다.** 세션 없이 문장만 들면, A 대화가 도는
   * 동안 줄 세운 말이 B 대화로 전환한 순간 **B 로 배달된다** — 턴이 끝나는
   * 순간의 화면이 수신자가 되는 오배송이다.
   */
  const [queue, setQueue] = useState<{ text: string; sessionId: string | null }[]>([]);
  /** ↑/↓ 프롬프트 되부르기의 현재 위치 (promptHistory.ts). */
  const recallRef = useRef<RecallState | null>(null);
  /** 마지막으로 보낸(보내려던) 지시 — 오류 뒤 "다시 보내기"가 쓴다. */
  const lastSentRef = useRef<string | null>(null);
  /**
   * 청크 합치기 버퍼. 토큰 하나마다 setState 하면 스레드 전체가 다시 그려지고
   * 마크다운이 매번 재파싱돼 **스트리밍이 렉처럼 끊겨 보인다**. 프로바이더
   * 채팅이 이미 같은 이유로 스로틀을 쓴다 — 여기도 같은 문턱을 쓴다.
   */

  // 지금 보고 있는 대화를 기억해 둔다 — 다시 띄웠을 때 여기로 돌아온다.
  useEffect(() => {
    const id = session?.session_id ?? null;
    setPrefs((prev) => {
      const current = codex ? prev.codexAcpLastSession : prev.acpLastSession;
      if (current === id) return prev;
      return codex ? { ...prev, codexAcpLastSession: id } : { ...prev, acpLastSession: id };
    });
  }, [codex, session?.session_id, setPrefs]);

  /**
   * 쓰다 만 글은 **대화를 따라간다.**
   *
   * 입력창이 화면에 하나뿐이라, 탭 A 에서 쓰다 탭 B 로 가면 반쯤 쓴 지시문이
   * B 의 입력창에 따라붙었다 — B 에서 지우면 A 의 글이 사라진 것이다. 대화를
   * 옮기는 순간 쓰던 글을 그 대화 몫으로 재워 두고, 돌아오면 꺼낸다.
   */
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const draftsRef = useRef<Record<string, string>>({});
  const prevSessionRef = useRef(activeId);
  useEffect(() => {
    const prev = prevSessionRef.current;
    if (prev === activeId) return;
    draftsRef.current = { ...draftsRef.current, [prev]: draftRef.current };
    prevSessionRef.current = activeId;
    setDraft(draftsRef.current[activeId] ?? "");
    recallRef.current = null;
  }, [activeId]);

  // 바깥에 알리는 것들(사이드바 배지·업데이트 문지기)과 대화에 남기는 구분선은
  // 조각 훅이 소유한다.
  useAcpSignals({
    projectId,
    provider,
    slate: SLATE,
    session,
    busySessions,
    permissions,
    editTurns,
    renameTab,
    promptsOf,
  });

  // 스크롤 정책(따라가기·맨 아래로·다시 보일 때 되잡기)은 조각 훅이 소유한다.
  const { attachThread, onThreadScroll, jumpToBottom, followBottom, awayFromBottom } =
    useThreadScroll(turns, permission);

  /** 목록·되읽기·열기·다시 연결은 조각 훅이 소유한다. */
  const { history, historyQuery, setHistoryQuery, refreshHistory, openSession, reconnect } =
    useAcpSessionSync({
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
      lastSessionId: codex ? prefs.codexAcpLastSession : prefs.acpLastSession,
      followBottom,
    });

  /**
   * 새 대화 — **빈 화면만 연다. 세션은 아직 만들지 않는다.**
   *
   * 예전에는 여기서 곧장 `session/new` 를 불렀다. 그런데 아무 말도 안 한 세션은
   * 어댑터의 목록에 실리지 않아서, 지난 대화 사이드바에는 없는 창이 하나 떠
   * 있는 상태가 됐다 — 닫으면 사라지고 어디에도 안 남는, 있는 것도 없는 것도
   * 아닌 대화다.
   *
   * `session_id` 를 비우는 것이 곧 "아직 안 만들어진 새 대화"라는 표시다.
   * 세션 설정(모델·Effort·권한)은 그대로 들고 있어야 컴포저가 살아 있으므로
   * 나머지 필드는 남긴다. 진짜 생성은 첫 마디를 보낼 때.
   */
  const newConversation = useCallback(() => {
    // 진행 중인 로드의 재생분이 새 대화에 쏟아지지 않게 세대를 올린다.
    loadSeqRef.current += 1;
    followBottom();
    setSession((prev) => (prev ? { ...prev, session_id: null, title: null } : prev));
    editTurns(SLATE, () => []);
    setAttachments([]);
    setImages([]);
    // 빈 자리의 몫만 지운다 — 방금 떠나온 대화는 계속 돌고 있을 수 있고,
    // 그 대화의 승인 카드는 돌아갔을 때 그 자리에 있어야 한다.
    putUsage(SLATE, null);
    putPermission(SLATE, null);
    putError(SLATE, null);
    // 새 대화를 연 다음 할 일은 하나뿐이다 — 입력. 클릭 한 번을 아껴 준다.
    inputRef.current?.focus();
  }, [editTurns, putUsage, putPermission, putError, followBottom, setAttachments, setImages]);

  /**
   * 같은 프로젝트에서 진짜 `claude` 를 터미널에 띄운다.
   *
   * 여기(ACP)로 못 닿는 기능이 있을 때의 탈출구다. 새 셸을 열고 첫 명령을
   * 등록해 두면, 그 셸이 뜨는 순간 `TerminalInstance` 가 한 번만 쳐 준다.
   */
  const openInTerminal = useCallback((prefill?: string) => {
    const id = newPtySessionId(runtime.currentProjectId);
    stageBootCommand(id, codex ? codexCommand(prefill) : claudeCommand(prefill));
    openTab(
      { id, label: codex ? "Codex" : "Claude Code", shell: "", cwd: runtime.currentProjectRoot ?? "" },
      { view: "terminal" },
    );
  }, [codex, runtime.currentProjectId, runtime.currentProjectRoot, openTab]);

  const closeTab = useAcpTabClose({
    slate: SLATE,
    tabs,
    forgetTab,
    currentSessionId: session?.session_id ?? null,
    pending,
    rootRef,
    openSession,
    newConversation,
  });

  /**
   * 대화를 **영구 삭제**한다 (`session/delete`).
   *
   * 지금 보고 있는 대화를 지웠으면 새 대화를 연다 — 지워진 대화를 계속 띄워
   * 두면 다음 질문이 없는 세션으로 날아간다. 이름표와 탭도 같이 치운다
   * (안 치우면 열 수 없는 탭이 남는다).
   */
  const remove = useCallback(
    async (sessionId: string) => {
      const res = await commands.acpDeleteSession(projectId, provider, sessionId);
      if (res.status !== "ok") {
        setError(tError(res.error));
        return;
      }
      // 어댑터 목록은 잠깐 더 이 대화를 들고 있다 — 우리 쪽에서 못 박아 둔다.
      removedRef.current.add(sessionId);
      forgetSession(sessionId);
      await refreshHistory();
      if (session?.session_id === sessionId) newConversation();
    },
    [projectId, provider, refreshHistory, session?.session_id, newConversation, forgetSession, setError, removedRef],
  );

  // 말 걸기 — 로컬 명령 갈래·세션 생성·대기줄·스트림 페이싱은 조각 훅이 소유한다.
  const send = useAcpSend({
    projectId,
    provider,
    codex,
    activeId,
    currentSessionId: session?.session_id ?? null,
    draft,
    setDraft,
    attachments,
    setAttachments,
    images,
    setImages,
    setMentions,
    setSlash,
    ultracode,
    queue,
    setQueue,
    busySessions,
    markBusy,
    putError,
    putUsage,
    putPermission,
    editTurns,
    setTranscripts,
    setSession,
    setError,
    addTab,
    openSession,
    newConversation,
    openInTerminal,
    activityRef,
    loadSeqRef,
    lastSentRef,
    recallRef,
    followBottom,
  });

  /** 보고 있는 대화만 멈춘다 — 옆에서 돌던 것은 계속 간다. */
  const cancel = useCallback(() => {
    reportFailure("acp_cancel", commands.acpCancel(projectId, provider, activeId === SLATE ? null : activeId), "acp.cancelFailed");
    putPermission(activeId, null);
  }, [projectId, provider, activeId, putPermission]);

  /**
   * 목록에서 **열지 않고** 중단 (Phase 3 `#inline-stop`).
   *
   * 지금까지 멈추는 길은 보고 있는 대화의 ESC/정지 버튼뿐이었다 — 뒤에서 도는
   * 대화를 멈추려면 먼저 그리로 옮겨 가야 했고, 옮기는 것 자체가 스트림의
   * 자리를 흔든다. 취소는 세션 id 로 보내면 되므로 갈 이유가 없다.
   */
  const stopSession = useCallback(
    (sessionId: string) => {
      reportFailure("acp_cancel", commands.acpCancel(projectId, provider, sessionId), "acp.cancelFailed");
      putPermission(sessionId, null);
    },
    [projectId, provider, putPermission],
  );

  // 세션 줄의 상태 — 이 화면이 이미 버스에 쓰고 있으므로 읽기도 여기서 한다.
  const rowStates = useAcpRowStates();
  const rowStateOf = useCallback(
    (sessionId: string) => acpRowStateOf(rowStates, projectId, sessionId, provider),
    [rowStates, projectId, provider],
  );
  /** 그 「도는 중」의 근거 — 신호가 멎었으면 화면이 그렇게 말한다. */
  const rowSourceOf = useCallback(
    (sessionId: string) => acpRowSourceOf(rowStates, projectId, sessionId, provider),
    [rowStates, projectId, provider],
  );
  /**
   * 활성 대화를 맨 위로. 원장(`stabilizeHistory`)이 정한 순서는 버킷 **안에서**
   * 그대로 살아 있다 — 활성은 그 앞에 붙는 별도 칸일 뿐이다.
   */
  const shownHistory = useMemo(
    () => sortActiveFirst(history ?? EMPTY_SESSIONS, (id) => rowStateOf(id) != null),
    [history, rowStateOf],
  );

  // ESC 로 중단 (구독의 전문은 `useEscCancel`).
  useEscCancel(busy, cancel, isVisible);

  const decide = useCallback((requestId: string, optionId: string | null) => {
    setPermission(null);
    // 「허용/거부」가 조용히 실패하면 에이전트는 영영 기다리고 화면은 카드를
    // 지운 뒤다 — 사용자에게는 앱이 멈춘 것처럼 보인다.
    reportFailure("acp_permission_respond", commands.acpPermissionRespond(requestId, optionId), "acp.respondFailed");
  }, [setPermission]);

  // 컴포저 키보드 — IME·모드 순환·되부르기·팝오버·전송의 우선순위는 조각 훅이 소유한다.
  const onKeyDown = useComposerKeys({
    draft,
    setDraft,
    userPrompts,
    recallRef,
    options: session?.options,
    setOption: (id, value) => void setOption(id, value),
    slash,
    slashIndex,
    setSlash,
    setSlashIndex,
    pickCommand,
    mentions,
    mentionIndex,
    setMentions,
    setMentionIndex,
    pickMention,
    send: () => void send(),
  });

  const tabItems = useAcpTabItems(tabs, nameOf, pending, SLATE);
  const pickSession = useCallback(
    (id: string) => {
      // 아직 안 만든 대화에는 열 것이 없다 (이미 그 자리에 있다).
      if (id === SLATE) return;
      void openSession(id);
    },
    [openSession],
  );

  const toolbar = (
    <AcpToolbar
      projectId={projectId}
      provider={provider}
      tabs={tabItems}
      activeId={activeId}
      slate={SLATE}
      panelOpen={panelOpen}
      onPick={pickSession}
      onClose={closeTab}
      onOpenInTerminal={() => openInTerminal()}
      onTogglePanel={() => setPrefs((prev) => ({ ...prev, acpPanelOpen: !prev.acpPanelOpen }))}
    />
  );

  if (!session) {
    return (
      <>
        {toolbar}
        <AcpOffPanel
          codex={codex}
          starting={starting}
          needsInstall={needsInstall}
          error={error}
          onInstall={() => void installAdapter()}
          onRetry={() => void retry()}
        />
      </>
    );
  }

  return (
    <>
    {toolbar}
    <div className="acp-layout" ref={rootRef}>
      <div className="ai-wrap">
      <div className="ai-thread" ref={attachThread} onScroll={onThreadScroll}>
        <div className="ai-thread-inner">
          {turns.length === 0 ? (
            <AcpReadyPanel codex={codex} />
          ) : (
            /* 묶음(지시 + 그 답)을 **실제 요소로** 그린다 — 지시문 sticky 의
               컨테이닝 블록이 이 묶음이어야 자기 답변이 끝날 때 자리를 비운다.
               평평하게 늘어놓았더니 카드가 top 에 겹겹이 쌓였다. */
            groups.map((group, gi, all) => (
              <section className="exchange" key={gi}>
                {group.map((turn, i) => (
                  <TurnRow
                    key={i}
                    turn={turn}
                    live={busy && gi === all.length - 1 && i === group.length - 1}
                  />
                ))}
              </section>
            ))
          )}

          {permission ? <PermissionCard request={permission} onDecide={decide} /> : null}

          {agentGone ? (
            <AgentGoneNotice starting={starting} onReconnect={() => void reconnect()} />
          ) : null}

          {/* 기록 도구 없이 열린 대화를 드러낸다 ({#mcp-missing-visible}) —
              붙었으면 아무 것도 안 그린다. */}
          <RecordingNotice
            projectId={projectId}
            provider={provider}
            sessionId={session?.session_id ?? null}
          />

          {/* 배달 게이트 — 턴이 끝날 때마다 다시 묻는다 ({#gate-beyond-cc}). */}
          <JournalGateNotice sessionId={session?.session_id ?? null} turnKey={busy} />

          {error ? (
            <AcpErrorCard
              message={error}
              canRetry={!busy && lastSentRef.current != null}
              onRetry={() => {
                setError(null);
                void send(lastSentRef.current ?? undefined);
              }}
              onDismiss={() => setError(null)}
            />
          ) : null}
        </div>
        {awayFromBottom ? (
          /* 위에서 앞 카드를 읽는 것은 허용된 동작이다 (stickRef) — 그렇다면
             돌아오는 길도 한 번의 클릭이어야 한다. */
          <button
            type="button"
            className="ai-scroll-fab"
            onClick={jumpToBottom}
            aria-label={t("ai.scrollBottom")}
            title={t("ai.scrollBottom")}
          >
            <ArrowDown size={15} />
          </button>
        ) : null}
      </div>

      <Composer
        activeId={activeId}
        draft={draft}
        setDraft={setDraft}
        onEdit={(next) => {
          // 손으로 고치기 시작하면 되부르기는 끝난 것이다 — 다음 ↑ 는
          // 다시 가장 최근부터.
          recallRef.current = null;
          setDraft(next);
        }}
        busy={busy}
        dropActive={dropActive}
        inputRef={inputRef}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        queue={queue}
        setQueue={setQueue}
        images={images}
        setImages={setImages}
        attachments={attachments}
        setAttachments={setAttachments}
        attach={() => void attach()}
        slash={slash}
        slashIndex={slashIndex}
        setSlashIndex={setSlashIndex}
        pickCommand={pickCommand}
        mentions={mentions}
        mentionIndex={mentionIndex}
        setMentionIndex={setMentionIndex}
        pickMention={pickMention}
        usage={usage}
        options={session.options}
        ultracode={ultracode}
        setUltracode={(on) => setPrefs((prev) => ({ ...prev, acpUltracode: on }))}
        setOption={(id, value) => void setOption(id, value)}
        onUsagePanel={requestUsagePanel}
        cancel={cancel}
        send={() => void send()}
      />
      </div>

      {/* 열고 닫을 때 **언마운트하지 않는다** — 사라졌다 나타나면 전이가
          불가능하고, 스크롤 위치와 검색어도 매번 날아간다. */}
      <SessionPanel
        open={panelOpen}
        sessions={shownHistory}
        currentId={session.session_id}
        query={historyQuery}
        onQuery={setHistoryQuery}
        onPick={pickSession}
        onNew={newConversation}
        onRename={rename}
        onDelete={remove}
        names={names}
        stateOf={rowStateOf}
        sourceOf={rowSourceOf}
        onStop={stopSession}
      />

    </div>
    </>
  );
}
