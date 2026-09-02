import { openSettings } from "@/lib/settingsNav";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Paperclip,
  Square,
  Terminal,
  TriangleAlert,
  X,
} from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { PanelLeft } from "@/components/Icons";
import { ClaudeMark, CLAUDE_ORANGE } from "@/components/ClaudeMark";
import { AcpUsageMeter } from "./AcpUsageMeter";
import { commands, events,
  type AcpEvent,
  type AcpImage,
  type AcpCommand,
  type AcpSession,
  type AcpSessionSummary,
} from "@/lib/bindings";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { useUiPrefs, useProjectRuntime, useTerminalSessions } from "@/contexts/WorkspaceContext";
import { useSessionMaps } from "./conversation/useSessionMaps";
import { type PermissionState } from "./conversation/shared";
import { ImageAttachment } from "./conversation/Attachments";
import { TurnRow } from "./conversation/TurnRow";
import { PermissionCard } from "./conversation/PermissionCard";
import { SessionPanel } from "./conversation/SessionPanel";
import {
  supportsUltracode,
  PRIMARY_CONFIG_IDS,
  CYCLE_MODES,
  ConfigControl,
  MoreSettings,
  EffortControl,
} from "./conversation/ConfigControls";
import {
  applyAcpEvent,
  closeTurn,
  groupTurns,
  insertNotice,
  openTurn,
  type AcpTurn,
} from "./acpTurns";

/**
 * 아직 안 보낸 이미지 — 프로토콜 몫(`block`) + 화면 몫(이름·픽셀 크기).
 *
 * 이름과 크기를 어댑터에 보낼 자리가 없어서 따로 든다. 화면에는 필요하다:
 * "image.png 1104×172" 가 있어야 무엇을 붙였는지 열어 보지 않고 안다.
 */
interface PendingImage {
  block: AcpImage;
  name: string;
  width: number;
  height: number;
}
import { applyMention, findMentionQuery } from "./acpMention";
import { applyCommand, filterCommands, findSlashQuery, withLocalCommands } from "./acpSlash";
import { withUltracode } from "./ultracode";
import { requestUsagePanel } from "./usageBus";
import {
  acpRowStateOf,
  acpWorkingKey,
  setAcpAttention,
  setAcpWorking,
  useAcpRowStates,
} from "./acpBusyBus";
import { recallBack, recallForward, type RecallState } from "./promptHistory";
import { markSpoken, sortActiveFirst, stabilizeHistory, type ActivityLedger } from "./acpHistory";
import { resolveTitle, titleFromPrompt } from "./acpTitle";
import { sameOptions } from "./acpOptions";
import { revealCount, splitAt } from "./streamPacer";
import { registerCloseHandler } from "@/lib/closeIntent";
import { registerBusy } from "@/lib/busyGuard";
import {
  claudeCommand,
  newPtySessionId,
  stageBootCommand,
} from "@/features/terminal/terminalLaunch";
import { AcpSessionTabs } from "./AcpSessionTabs";

/** 아직 안 만든 새 대화의 기록이 머무는 자리 (`session_id` 가 아직 없다). */
const SLATE = "";

/** 빈 기록의 **한 개짜리** 배열 — 매 렌더 새 배열을 만들면 memo 가 다 깨진다. */
const EMPTY_TURNS: AcpTurn[] = [];

/** 같은 이유의 빈 목록 (아직 대화 목록을 못 읽었을 때). */
const EMPTY_SESSIONS: AcpSessionSummary[] = [];

/**
 * 지난 대화 **목록의 내용**을 바꾸는 사건들.
 *
 * 목록 조회는 어댑터로 나가는 진짜 왕복이라 아무 알림에나 달면 안 된다 —
 * 특히 `usage` 는 턴이 도는 동안 계속 온다. 줄이 생기거나(created) 사라지거나
 * (deleted) 이름이 붙는(title) 때만 다시 읽는다.
 */
const HISTORY_KINDS: ReadonlySet<string> = new Set(["created", "deleted", "title"]);

/**
 * "바닥에 있다"로 볼 여유 (px).
 *
 * 정확히 0 을 요구하면 안 된다 — 글이 흐르는 동안 마지막 줄이 자라면서 몇 px
 * 씩 어긋나고, 그때마다 따라가기가 꺼져 버린다.
 */
const STICK_SLACK_PX = 64;

// PR-ACP2~5 — ACP 대화면 (docs/acp-panel/00-master-plan.md §5).
//
// 프로바이더 채팅(AiPanelScreenV2 본체)과 **상태를 공유하지 않는다.** 저쪽은
// 우리가 히스토리를 들고 매번 통째로 재전송하지만, ACP 는 세션이 에이전트 쪽에
// 살아 있어 우리는 화면에 그릴 것만 들고 있으면 된다.
//
// 화면의 성격도 다르다: 채팅이 아니라 **작업 콘솔**이다. 사람의 말과 기계의
// 행적(도구 호출·승인)이 한 흐름에 섞이므로, 산문은 크게 읽히고 행적은 왼쪽
// 헤어라인에 묶여 눌린다 (agent.css `.trace`).


export function AcpConversation({ projectId }: { projectId: number }) {
  const { t } = useT();
  // Phase 4 #workspace-split — 취향(acp*)·런타임(프로젝트)·터미널(「터미널에서」) 조각.
  const { prefs, setPrefs } = useUiPrefs();
  const runtime = useProjectRuntime();
  const { openTab } = useTerminalSessions();
  const panelOpen = prefs.acpPanelOpen;
  /**
   * 사용자가 붙인 이름표. **우리 쪽에만 있다** — 프로토콜에 제목을 고치는
   * 요청이 없어서(있는 것은 지우기뿐) 에이전트의 제목은 그대로 두고 화면에서만
   * 우리 이름이 이긴다. 그래서 이 이름은 이 컴퓨터를 벗어나지 않는다.
   */
  const names = prefs.acpNames;
  const nameOf = useCallback(
    (id: string | null, fallback: string | null) => (id ? (names[id] ?? fallback) : fallback),
    [names],
  );
  const ultracode = prefs.acpUltracode;
  const tabs = prefs.acpTabs;

  /** 탭 목록을 갱신한다 (없으면 추가, 있으면 제목만 최신으로). */
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
        prev.acpTabs.some((tab) => tab.id === id)
          ? prev
          : { ...prev, acpTabs: [...prev.acpTabs, { id, title }] },
      );
    },
    [setPrefs],
  );

  /** 제목만 갱신 — **없는 탭을 만들지 않는다**(그게 되살아남의 통로였다). */
  const renameTab = useCallback(
    (id: string | null, title: string | null) => {
      if (!id || title === null) return;
      setPrefs((prev) => {
        const at = prev.acpTabs.findIndex((tab) => tab.id === id);
        if (at === -1 || prev.acpTabs[at].title === title) return prev;
        const next = [...prev.acpTabs];
        next[at] = { id, title };
        return { ...prev, acpTabs: next };
      });
    },
    [setPrefs],
  );
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
  /** 어댑터에 붙었는가 — 되읽기 구독을 걸지 말지의 유일한 근거다. */
  const hasSession = session != null;
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
  const [starting, setStarting] = useState(false);
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
  /** 이번 프롬프트에 함께 보낼 파일 (상대·절대 섞여도 백엔드가 맞춘다). */
  const [attachments, setAttachments] = useState<string[]>([]);
  /**
   * 붙여넣은 이미지. 파일과 달리 **내용을 실어 보낸다** — 클립보드 이미지는
   * 디스크에 존재하지도 않아 링크로 줄 수가 없다.
   */
  /**
   * 보낼 이미지. 프로토콜에 보내는 것(`AcpImage`)보다 **더 들고 있는다** —
   * 파일 이름과 픽셀 크기는 어댑터에 보낼 자리가 없지만 화면에는 필요하다
   * ("image.png 1104×172"). 보낼 때 프로토콜 몫만 떼어 낸다.
   */
  const [images, setImages] = useState<PendingImage[]>([]);
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
  /** `@` 자동완성 후보. `null` 이면 닫힌 상태. */
  const [mentions, setMentions] = useState<string[] | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  /** `/` 커맨드 후보. `null` 이면 닫힌 상태. */
  const [slash, setSlash] = useState<AcpCommand[] | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  /** 과거 대화 목록. `null` 이면 아직 안 불러온 상태. */
  const [history, setHistory] = useState<AcpSessionSummary[] | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** 바닥에서 떨어져 있는가 — FAB("맨 아래로")를 보일지의 근거. */
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  /** ↑/↓ 프롬프트 되부르기의 현재 위치 (promptHistory.ts). */
  const recallRef = useRef<RecallState | null>(null);
  /** 파일을 끌어와 얹으려는 중 — 컴포저에 놓을 자리를 그린다. */
  const [dropActive, setDropActive] = useState(false);
  /** 마지막으로 보낸(보내려던) 지시 — 오류 뒤 "다시 보내기"가 쓴다. */
  const lastSentRef = useRef<string | null>(null);
  /** 어댑터 프로세스가 죽은 것을 감지했다 — 배너와 다시 연결 버튼의 근거. */
  const [agentGone, setAgentGone] = useState(false);
  /** 살아 있는 것을 한 번이라도 봤는가 — "죽었다"는 살아 있던 것만 말할 수 있다. */
  const aliveRef = useRef(false);
  /**
   * 청크 합치기 버퍼. 토큰 하나마다 setState 하면 스레드 전체가 다시 그려지고
   * 마크다운이 매번 재파싱돼 **스트리밍이 렉처럼 끊겨 보인다**. 프로바이더
   * 채팅이 이미 같은 이유로 스로틀을 쓴다 — 여기도 같은 문턱을 쓴다.
   */

  // 사용자가 "시작"을 누르게 하지 않는다 — 화면에 들어오면 붙는다.
  // `acp_start` 는 멱등이라(이미 떠 있으면 그대로) 재진입 비용이 거의 없다.
  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setError(null);
    setStarting(true);
    void commands
      .acpStart(projectId)
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") setSession(res.data);
        else setError(tError(res.error));
      })
      .finally(() => {
        if (!cancelled) setStarting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // `@` 를 치는 동안만 후보를 부른다 — 멘션이 아닐 땐 즉시 닫아 디스크를
  // 매 입력마다 걷지 않는다. 짧은 디바운스: 이 조회는 키 하나마다 디스크를
  // 걷는 일이라, 빠르게 치는 동안은 마지막 한 번만 나가면 된다.
  useEffect(() => {
    const mention = findMentionQuery(draft);
    if (!mention) {
      setMentions(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void commands.acpListFiles(projectId, mention.query, 8).then((res) => {
        if (cancelled) return;
        setMentions(res.status === "ok" ? res.data : []);
        setMentionIndex(0);
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft, projectId, t]);

  // `/` 로 시작할 때만 커맨드 목록을 부른다. 목록은 세션 시작 **알림**으로
  // 오므로 시작 응답 스냅샷은 비어 있을 수 있다 — 칠 때 묻는 편이 항상 최신이다.
  useEffect(() => {
    const typed = findSlashQuery(draft);
    if (!typed) {
      setSlash(null);
      return;
    }
    let cancelled = false;
    void commands.acpCommands(projectId).then((res) => {
      if (cancelled) return;
      // 어댑터 목록 + 앱이 직접 처리하는 명령(`/clear`·`/continue`·`/rc` …).
      // 어댑터가 못 주는 것까지 합쳐야 `/` 를 눌렀을 때 실제로 되는 것이 다 보인다.
      const all = withLocalCommands(res.status === "ok" ? res.data : [], (key) =>
        t(key as Parameters<typeof t>[0]),
      );
      setSlash(filterCommands(all, typed.query));
      setSlashIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [draft, projectId]);

  /**
   * 입력창이 내용을 따라 자란다 (최대 180px — 프로바이더 채팅과 같은 상한).
   *
   * 없으면 두 줄 고정 칸 안에서 긴 지시문을 **안경 구멍으로** 쓰게 된다 —
   * 번호 매긴 요구사항 대여섯 줄이 이 화면의 평범한 입력이다.
   */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [draft]);

  // 지금 보고 있는 대화를 기억해 둔다 — 다시 띄웠을 때 여기로 돌아온다.
  useEffect(() => {
    const id = session?.session_id ?? null;
    setPrefs((prev) => (prev.acpLastSession === id ? prev : { ...prev, acpLastSession: id }));
  }, [session?.session_id, setPrefs]);

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

  /**
   * 승인 대기를 사이드바에 알린다 — 작업 중과 **다른 신호**다. 작업 중은
   * 기다리면 되지만 승인 대기는 사용자가 눌러야 풀린다. 이 표시가 없으면
   * 다른 화면에서 "아직 도는 중"으로 믿고 기다리다 몇 분을 잃는다.
   */
  useEffect(() => {
    const keys = Object.keys(permissions).map((id) =>
      acpWorkingKey(projectId, id === SLATE ? null : id),
    );
    keys.forEach((key) => setAcpAttention(key, true));
    return () => keys.forEach((key) => setAcpAttention(key, false));
  }, [permissions, projectId]);

  /**
   * 파일 드래그&드롭 → 첨부.
   *
   * HTML 드롭은 Tauri 가 가로채므로(웹뷰 기본) OS 드롭은 **Tauri 이벤트**로만
   * 받을 수 있다. 이 화면이 보일 때만 받는다 — keep-alive 로 배경에 살아 있는
   * 다른 프로젝트 탭이 드롭을 삼키면 안 된다.
   */
  const projectRoot = runtime.currentProjectRoot;
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const off = await getCurrentWebview().onDragDropEvent((event) => {
          if (!isVisible()) return;
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setDropActive(true);
            return;
          }
          setDropActive(false);
          if (payload.type !== "drop" || !payload.paths.length) return;
          // 프로젝트 안의 파일이면 상대경로로 — 칩과 프롬프트가 짧게 읽힌다.
          const rel = payload.paths.map((path) =>
            projectRoot && path.startsWith(projectRoot + "/")
              ? path.slice(projectRoot.length + 1)
              : path,
          );
          setAttachments((prev) => [...new Set([...prev, ...rel])]);
          inputRef.current?.focus();
        });
        if (disposed) off();
        else unlisten = off;
      } catch {
        // 웹뷰 밖(테스트·브라우저)에서는 이 API 가 없다 — 드롭만 없는 채로 산다.
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isVisible, projectRoot]);

  /**
   * 모델이 바뀌면 대화에 **구분선 한 줄**을 남긴다.
   *
   * 안 남기면 나중에 스크롤을 올렸을 때 어디까지가 어느 모델의 답인지 알 수 없다 —
   * 특히 답의 결이 달라졌을 때 "왜 갑자기 이러지"의 답이 여기 있다.
   *
   * **대화별로** 마지막 값을 기억한다: 다른 대화를 열면 그쪽 모델로 갈아끼워지는데,
   * 세션 구분 없이 보면 그것까지 "바꿨다"로 잘못 읽는다. 처음 본 값도 조용히
   * 기록만 한다 — 시작 모델은 바뀐 것이 아니다.
   */
  const modelSeenRef = useRef<{ session: string; model: string } | null>(null);
  useEffect(() => {
    const id = session?.session_id;
    const model = session?.options.find((o) => o.id === "model")?.current;
    if (!id || !model) return;

    const seen = modelSeenRef.current;
    modelSeenRef.current = { session: id, model };
    if (!seen || seen.session !== id || seen.model === model) return;

    const label = session?.options
      .find((o) => o.id === "model")
      ?.choices.find((choice) => choice.value === model)?.name;
    editTurns(id, (prev) => insertNotice(prev, t("acp.switchedTo", { model: label || model })));
  }, [session?.session_id, session?.options, editTurns, t]);

  // 제목이 붙으면 열려 있는 탭에 반영한다 (없는 탭은 만들지 않는다).
  // **받은 그대로 쓰지 않는다** — 지시문의 메아리를 걸러 낸다 (acpTitle.ts).
  useEffect(() => {
    const id = session?.session_id;
    if (!id) return;
    renameTab(id, resolveTitle(session?.title ?? null, promptsOf(id)));
  }, [session?.session_id, session?.title, renameTab, promptsOf]);


  /**
   * 답변이 도는 동안은 **업데이트 재시작을 막는다.**
   *
   * 재시작은 우리가 띄운 어댑터를 같이 죽이고, 그때 흐르던 답변은 아직 디스크에
   * 없어 그대로 사라진다. 새 번들을 까는 것까지는 언제든 해도 된다 — 기다리는
   * 것은 마지막 한 걸음뿐이다.
   */
  useEffect(
    // 보고 있는 대화가 아니어도 잡는다 — 뒤에서 도는 턴도 재시작이면 함께 죽는다.
    () => registerBusy(() => (busySessions.size ? t("acp.busyReason") : null)),
    [busySessions, t],
  );

  /**
   * 사이드바에 "몇 개가 돌고 있는지"를 알린다.
   *
   * 이 화면을 떠나도 턴은 계속 돈다 — 그런데 떠난 순간부터 **아무 표시도 없다**.
   * 다 됐는지 보려고 되돌아오는 일이 반복됐다. 언마운트(창을 닫거나 프로젝트
   * 탭을 접을 때)에도 반드시 지운다: 안 지우면 끝나지 않는 유령이 남는다.
   */
  useEffect(() => {
    const keys = [...busySessions].map((id) => acpWorkingKey(projectId, id === SLATE ? null : id));
    keys.forEach((key) => setAcpWorking(key, true));
    return () => keys.forEach((key) => setAcpWorking(key, false));
  }, [busySessions, projectId]);

  /**
   * 스트리밍 중에는 맨 아래를 따라간다 — **사용자가 바닥에 있을 때만.**
   *
   * 예전에는 턴이 바뀔 때마다 무조건 바닥으로 끌어내렸다. 그래서 답이 흐르는
   * 동안 위로 올려 앞의 도구 카드를 읽는 것이 불가능했다 — 올리자마자 다시
   * 내려갔다. 바닥 근처에 있었으면 따라가고, 일부러 올라가 있으면 그 자리를
   * 지킨다 (다시 바닥까지 내리면 따라가기가 저절로 켜진다).
   */
  const stickRef = useRef(true);
  const onThreadScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK_PX;
    stickRef.current = stick;
    // FAB 의 근거 — ref 와 달리 화면이 알아야 하는 값이라 상태로도 든다.
    setAwayFromBottom(!stick);
  }, []);

  /** "맨 아래로" — 위에서 읽다 돌아오는 한 번의 길. 누르면 따라가기도 다시 켜진다. */
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setAwayFromBottom(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  /**
   * 스크롤러를 붙잡는 ref — 크기 변화도 함께 듣는다.
   *
   * 이 화면은 keep-alive 라 다른 화면에 가 있는 동안에도 글이 쌓이는데, 그때는
   * `display:none` 이라 레이아웃이 없어 `scrollTop` 을 써도 0 에 머문다. 돌아오면
   * 맨 위가 보였다. 크기가 0 → 실제로 돌아오는 순간이 곧 "다시 보인다"라서,
   * 그때 바닥을 다시 잡는다.
   */
  const threadResizeRef = useRef<ResizeObserver | null>(null);
  const attachThread = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    threadResizeRef.current?.disconnect();
    threadResizeRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current && el.clientHeight > 0) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    threadResizeRef.current = observer;
  }, []);
  useEffect(() => () => threadResizeRef.current?.disconnect(), []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns, permission]);

  const retry = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await commands.acpStart(projectId);
      if (res.status === "ok") setSession(res.data);
      else setError(tError(res.error));
    } finally {
      setStarting(false);
    }
  }, [projectId]);

  const setOption = useCallback(
    async (configId: string, value: string) => {
      const res = await commands.acpSetConfigOption(projectId, configId, value);
      if (res.status === "ok") {
        setSession((prev) => (prev ? { ...prev, options: res.data } : prev));
      } else {
        setError(tError(res.error));
      }
    },
    [projectId],
  );

  const attach = useCallback(async () => {
    const res = await commands.acpPickFiles(projectId);
    if (res.status === "ok" && res.data.length) {
      setAttachments((prev) => [...new Set([...prev, ...res.data])]);
    }
  }, [projectId]);

  /** 클립보드에서 이미지를 받는다. 텍스트 붙여넣기는 기본 동작 그대로. */
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (!files.length) return;
    e.preventDefault();

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        // `data:image/png;base64,AAA…` 에서 본문만 — 접두사를 그대로 보내면
        // 어댑터가 base64 로 못 읽는다.
        const comma = result.indexOf(",");
        if (comma < 0) return;
        const block: AcpImage = {
          mime_type: file.type,
          data_base64: result.slice(comma + 1),
        };
        // 크기는 한 번 그려 봐야 안다. 못 재도 이미지는 보낸다 — 치수는
        // 곁들이는 정보이지 보낼 수 있느냐의 조건이 아니다.
        const probe = new Image();
        const add = (width: number, height: number) =>
          setImages((prev) => [...prev, { block, name: file.name || "image", width, height }]);
        probe.onload = () => add(probe.naturalWidth, probe.naturalHeight);
        probe.onerror = () => add(0, 0);
        probe.src = result;
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const pickMention = useCallback(
    (relPath: string) => {
      const mention = findMentionQuery(draft);
      if (!mention) return;
      setDraft(applyMention(draft, mention, relPath));
      setAttachments((prev) => [...new Set([...prev, relPath])]);
      setMentions(null);
      inputRef.current?.focus();
    },
    [draft],
  );

  /**
   * 대화 목록을 다시 읽는다. **실패해도 조용하다** — 이 조회는 사용자가 시킨
   * 것이 아니라 탭 제목을 채우려고 세션이 붙을 때마다 우리가 도는 것이라,
   * 실패를 대화창에 띄우면 아무 것도 안 했는데 빨간 줄이 뜬다. 목록이 비면
   * 패널이 자기 빈 상태를 보여 준다.
   */
  const refreshHistory = useCallback(async () => {
    const res = await commands.acpListSessions(projectId);
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
  }, [projectId, promptsOf]);

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
      void commands.acpStatus(projectId).then((res) => {
        if (res.status !== "ok") return;
        if (res.data) {
          aliveRef.current = true;
          setAgentGone(false);
        } else if (aliveRef.current) {
          aliveRef.current = false;
          setAgentGone(true);
        }
      });
      void commands.acpOptions(projectId).then((res) => {
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
      void commands.acpSessionTitle(projectId).then((res) => {
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
    let off: (() => void) | undefined;
    void events.acpSessionChanged
      .listen((evt) => {
        if (evt.payload.project_id !== projectId) return;
        sync();
        // 목록의 **내용**이 바뀌는 종류만 다시 읽는다. 뒤에서 도는 대화의
        // 제목은 이 길로만 탭에 닿는다 — 제목은 이제 그 대화의 칸에 들어가서
        // 보고 있는 화면의 상태(`session.title`)로는 오지 않는다.
        if (HISTORY_KINDS.has(evt.payload.kind)) void refreshHistory();
      })
      .then((fn) => {
        off = fn;
      })
      .catch(() => {});
    const onWake = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      if (off) off();
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [projectId, hasSession, isVisible, refreshHistory]);

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
    if (!history?.length) return;
    setPrefs((prev) => {
      let changed = false;
      const next = prev.acpTabs.map((tab) => {
        const found = history.find((item) => item.id === tab.id);
        if (!found?.title || found.title === tab.title) return tab;
        changed = true;
        return { ...tab, title: found.title };
      });
      return changed ? { ...prev, acpTabs: next } : prev;
    });
  }, [history, setPrefs]);

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
      stickRef.current = true;
      setAwayFromBottom(false);

      // 이미 이 창에서 본 대화면 **다시 읽지 않는다.**
      //
      // 우리 기록이 디스크보다 최신이다 — 아직 흐르고 있는 답은 디스크에 없다.
      // `session/load` 로 갈아타면 그 답을 놓칠 뿐 아니라, 그 대화에 물려 있는
      // 스트림의 자리를 잠깐 빼앗아 아예 멎게 만든다. 장부만 바꾼다.
      if (transcriptsRef.current[sessionId]?.length) {
        const title = tabs.find((tab) => tab.id === sessionId)?.title ?? null;
        const picked = await commands.acpSelectSession(projectId, sessionId, title);
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

      const res = await commands.acpLoadSession(projectId, sessionId, channel);
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
    [projectId, addTab, editTurns, tabs, putUsage, putPermission, putError],
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
      const res = await commands.acpStart(projectId);
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
  }, [projectId, session?.session_id, refreshHistory, openSession]);

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
    const last = prefs.acpLastSession;
    if (!last || last === session.session_id) return;
    if (!history.some((item) => item.id === last)) return;
    void openSession(last);
  }, [session, history, prefs.acpLastSession, openSession]);

  const pickCommand = useCallback((command: AcpCommand) => {
    setDraft(applyCommand(command));
    setSlash(null);
    inputRef.current?.focus();
  }, []);

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
    stickRef.current = true;
    setAwayFromBottom(false);
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
  }, [editTurns, putUsage, putPermission, putError]);

  /**
   * 같은 프로젝트에서 진짜 `claude` 를 터미널에 띄운다.
   *
   * 여기(ACP)로 못 닿는 기능이 있을 때의 탈출구다. 새 셸을 열고 첫 명령을
   * 등록해 두면, 그 셸이 뜨는 순간 `TerminalInstance` 가 한 번만 쳐 준다.
   */
  const openInTerminal = useCallback((prefill?: string) => {
    const id = newPtySessionId(runtime.currentProjectId);
    stageBootCommand(id, claudeCommand(prefill));
    openTab(
      { id, label: "Claude Code", shell: "", cwd: runtime.currentProjectRoot ?? "" },
      { view: "terminal" },
    );
  }, [runtime.currentProjectId, runtime.currentProjectRoot, openTab]);

  /**
   * 탭을 닫는다. **보고 있던 탭이면 다른 탭으로 옮겨 간다** — 안 그러면 탭은
   * 없는데 그 대화가 화면에 그대로 남고, 그 상태에서 말을 걸면 방금 닫은 탭이
   * 되살아난다("닫아도 안 닫힌다"의 정체).
   */
  const closeTab = useCallback(
    (id: string) => {
      // 아직 안 만든 대화는 `acpTabs` 에 없다 — 닫는다는 것은 곧 하던 대화로
      // 돌아가는 것이다. (돌아갈 곳이 없으면 닫기 버튼 자체가 안 뜬다.)
      if (id === SLATE) {
        if (tabs.length) void openSession(tabs[tabs.length - 1].id);
        return;
      }
      setPrefs((prev) => ({
        ...prev,
        acpTabs: prev.acpTabs.filter((tab) => tab.id !== id),
      }));
      if (session?.session_id !== id) return;
      const rest = tabs.filter((tab) => tab.id !== id);
      if (rest.length) void openSession(rest[rest.length - 1].id);
      else newConversation();
    },
    [session?.session_id, tabs, openSession, newConversation, setPrefs],
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
        const current = session?.session_id;
        // 아직 안 만든 대화도 닫는다 — 돌아갈 대화가 있을 때만(빈 화면 하나만
        // 남기고 창을 붙잡고 있으면 ⌘W 가 영영 안 먹는 것처럼 보인다).
        if (!current) {
          if (!pending || !tabs.length) return false;
          closeTab(SLATE);
          return true;
        }
        if (!tabs.some((tab) => tab.id === current)) return false;
        closeTab(current);
        return true;
      }),
    [session?.session_id, pending, tabs, closeTab],
  );

  /**
   * 이름표를 붙인다(빈 문자열이면 뗀다). 에이전트에게는 보내지 않는다 —
   * 프로토콜에 제목을 고치는 요청이 없다.
   */
  const rename = useCallback(
    (sessionId: string, next: string) => {
      const label = next.trim();
      setPrefs((prev) => {
        const names = { ...prev.acpNames };
        if (label) names[sessionId] = label;
        else delete names[sessionId];
        return { ...prev, acpNames: names };
      });
    },
    [setPrefs],
  );

  /**
   * 대화를 **영구 삭제**한다 (`session/delete`).
   *
   * 지금 보고 있는 대화를 지웠으면 새 대화를 연다 — 지워진 대화를 계속 띄워
   * 두면 다음 질문이 없는 세션으로 날아간다. 이름표와 탭도 같이 치운다
   * (안 치우면 열 수 없는 탭이 남는다).
   */
  const remove = useCallback(
    async (sessionId: string) => {
      const res = await commands.acpDeleteSession(projectId, sessionId);
      if (res.status !== "ok") {
        setError(tError(res.error));
        return;
      }
      // 어댑터 목록은 잠깐 더 이 대화를 들고 있다 — 우리 쪽에서 못 박아 둔다.
      removedRef.current.add(sessionId);
      setPrefs((prev) => {
        const names = { ...prev.acpNames };
        delete names[sessionId];
        return {
          ...prev,
          acpNames: names,
          acpTabs: prev.acpTabs.filter((tab) => tab.id !== sessionId),
        };
      });
      await refreshHistory();
      if (session?.session_id === sessionId) newConversation();
    },
    [projectId, refreshHistory, session?.session_id, newConversation, setPrefs],
  );

  const send = useCallback(
    /**
     * `target` 은 **말을 걸 대화**다. 생략하면 지금 보고 있는 대화.
     *
     * 대기줄이 이걸 쓴다 — 뒤에 있는 대화의 줄이 풀릴 때 그 순간 화면이 어디를
     * 보고 있든 제 대화로 가야 한다. 예전에는 백엔드의 "활성 대화" 장부로
     * 보냈기 때문에 **턴이 끝나는 순간의 화면**이 수신자였다.
     */
    async (override?: string, target?: string) => {
      const text = (override ?? draft).trim();
      if (!text) return;
      /** 이 전송이 향하는 대화. `SLATE` 면 아직 만들지 않은 새 대화다. */
      const aim = target ?? activeId;
      /** 입력창에서 곧장 보내는가 — 스크롤·첨부·초안은 그때만 건드린다. */
      const fromComposer = override === undefined;

      // `/usage` 는 대화가 아니라 **계기판**이다. 채팅에 남기면 긴 표가 대화를
      // 밀어내고, 다시 보려면 스크롤을 거슬러 올라가야 한다 — 위젯으로 보낸다.
      if (text === "/usage") {
        setDraft("");
        setSlash(null);
        requestUsagePanel();
        return;
      }

      // `/clear` 를 그냥 보내면 CLI 쪽 문맥만 비고 **화면은 그대로** 남아 둘이
      // 어긋난다. 우리 쪽에서 세션을 새로 여는 것이 같은 의도의 정확한 실행이다.
      if (text === "/clear") {
        setDraft("");
        setSlash(null);
        newConversation();
        return;
      }

      // `/continue` — CLI 의 `--continue` 와 같은 뜻: 최근 대화로 돌아간다.
      //
      // **지금 열려 있는 것은 후보에서 뺀다.** 이 명령을 치는 이유가 "여기 말고
      // 아까 거기"이기 때문이다. 앱을 켜면 빈 세션이 자동으로 열리는데, 그것이
      // 목록에 실리든 안 실리든 이 규칙이면 둘 다 원하는 결과가 나온다.
      if (text === "/continue") {
        setDraft("");
        setSlash(null);
        void (async () => {
          const res = await commands.acpListSessions(projectId);
          if (res.status !== "ok") {
            setError(tError(res.error));
            return;
          }
          const previous = res.data.filter((item) => item.id !== session?.session_id);
          if (!previous.length) {
            setError(t("acp.continueNone"));
            return;
          }
          await openSession(previous[0].id);
        })();
        return;
      }

      // `/remote-control` (`/rc`) — 어댑터가 광고하는 명령은 아니지만 통로는 있다.
      //
      // 어댑터가 `session/new` 의 `_meta.claudeCode.options.extraArgs` 를 CLI
      // 플래그로 그대로 흘려보내고, CLI 에 `--remote-control` 이 있다. 다만
      // 질의를 만들 때 정해지는 값이라 **켜져 있는 대화에는 못 붙인다** — 새
      // 대화를 열어야 한다. 실패하면 백엔드가 원래 대화를 되돌려 놓는다.
      // `/remote-control` (`/rc`) — **터미널로 보낸다.**
      //
      // ACP 안에서도 해 봤다(2026-08-15): `_meta.claudeCode.options.extraArgs` 로
      // `--remote-control` 을 넘기면 어댑터가 CLI 플래그로 흘려 주고, 세션은
      // 오류 없이 열린다. 그런데 **짝짓기 안내가 어디에도 안 나온다** — 대화에도,
      // 어댑터 stderr(앱 로그)에도. 그 안내는 CLI 가 자기 화면에 그리는 것이라
      // 프로토콜로 옮겨질 데이터가 애초에 없다.
      //
      // 터미널에서는 그 화면이 곧 우리 화면이라 그냥 된다.
      if (text === "/remote-control" || text === "/rc") {
        setDraft("");
        setSlash(null);
        openInTerminal("/remote-control");
        return;
      }

      // **그 대화가** 도는 중일 때만 줄을 선다. 옆 대화가 도는 것은 상관없다 —
      // 예전에는 화면에 하나뿐인 표시를 봤기 때문에, A 가 도는 동안 B 에 친 말이
      // A 가 끝날 때까지 멎어 있었다.
      if (busySessions.has(aim)) {
        setQueue((prev) => [...prev, { text, sessionId: aim === SLATE ? null : aim }]);
        if (fromComposer) setDraft("");
        recallRef.current = null;
        return;
      }

      // 보내는 순간부터 이 화면은 새 세대다 — 아직 흐르고 있는 재생분이 내
      // 질문 위에 지난 대화를 덧그리면 안 된다. **보고 있는 대화일 때만** 올린다:
      // 뒤에 있는 대화의 대기줄이 풀린 것이라면, 지금 화면에서 읽고 있는 대화의
      // `session/load` 재생을 남의 사정으로 끊는 셈이 된다.
      if (aim === activeId) loadSeqRef.current += 1;
      // 아직 안 만든 새 대화라면 **지금** 만든다 (새 대화 버튼은 화면만 비운다).
      // 만들어야만 보낼 id 가 생긴다 — `acp_prompt` 는 이제 대화를 인자로 받고,
      // 인자가 없으면 백엔드 장부를 따르는데 그 장부는 **직전 대화**를 가리킨다.
      let resolved: string | null = aim === SLATE ? null : aim;
      if (!resolved) {
        // 세션을 만드는 동안에도 이 자리는 이미 "보내는 중"이다 — 표시가 없으면
        // 사용자가 한 번 더 누른다.
        markBusy(SLATE, true);
        const opened = await commands.acpNewSession(projectId);
        markBusy(SLATE, false);
        if (opened.status !== "ok") {
          putError(SLATE, tError(opened.error));
          return;
        }
        setSession(opened.data);
        resolved = opened.data.session_id;
        // 빈 자리에 있던 기록은 이제 이 대화의 것이다.
        if (resolved) {
          const id = resolved;
          setTranscripts((prev) => ({ ...prev, [id]: prev[SLATE] ?? [], [SLATE]: [] }));
        }
      }
      // 여기까지 왔는데 id 가 없으면 보낼 곳이 없다 — 조용히 나가면 입력만
      // 사라지고 아무 일도 안 일어난 것처럼 보인다.
      if (!resolved) {
        putError(SLATE, t("acp.sendNoSession"));
        return;
      }
      const into = resolved;

      // 이 대화에 실제로 말을 걸었다 — 이제 진짜로 가장 최근이다.
      markSpoken(activityRef.current, into, new Date().toISOString());
      // 어댑터의 제목은 턴이 끝난 뒤에야 온다. 그때까지 "제목 없는 대화"로 두지
      // 않는다 — 첫 마디가 곧 그 대화가 무엇인지다(CLI 도 그렇게 연다). 이미
      // 있는 탭은 `addTab` 이 건드리지 않으므로, 이어 가는 대화의 이름은 그대로다.
      addTab(into, titleFromPrompt(text));
      const outgoing = withUltracode(text, ultracode);
      // 첨부는 **입력창의 것**이다 — 대기줄에서 꺼낸 문장에 지금 얹혀 있는 파일을
      // 딸려 보내면, 다른 대화에 붙여 두었던 것이 엉뚱한 대화로 간다.
      const sending = fromComposer ? attachments : [];
      const sendingImages = fromComposer ? images : [];
      const sendingBlocks: AcpImage[] = sendingImages.map((image) => image.block);
      lastSentRef.current = text;
      recallRef.current = null;
      if (fromComposer) {
        setDraft("");
        setAttachments([]);
        setImages([]);
        setMentions(null);
        setSlash(null);
      }
      putError(into, null);
      editTurns(into, (prev) =>
        openTurn(
          prev,
          text,
          {
            attachments: sending,
            images: sendingImages.map((image) => ({
              src: `data:${image.block.mime_type};base64,${image.block.data_base64}`,
              name: image.name,
              width: image.width,
              height: image.height,
            })),
          },
          Date.now(),
        ),
      );
      // 내가 방금 말을 걸었다 — 이제 바닥이 관심사다. 단 **보고 있는 대화일
      // 때만**: 뒤에 있는 대화의 대기줄이 풀린 것이라면, 화면에 있지도 않은
      // 대화 때문에 지금 읽던 자리가 바닥으로 끌려간다.
      if (aim === activeId) stickRef.current = true;
      markBusy(into, true);

      /**
       * **도착과 표시를 끊는다.**
       *
       * 예전에는 프레임마다 "그 사이 도착한 것"을 통째로 얹었다. 그래서 화면의
       * 리듬이 곧 네트워크의 리듬이었다 — 한 덩어리가 오면 한 덩어리가 툭
       * 튀어나오고 조용하면 화면도 멈춘다. rAF 는 *언제* 그릴지만 골랐지
       * *얼마나* 그릴지는 안 골랐다.
       *
       * 이제 도착분은 대기줄에 쌓고, 매 프레임 대기줄에서 **자기 속도로** 꺼내
       * 쓴다. 밀릴수록 빨라지므로 뒤처지지도 않는다 (streamPacer.ts).
       */
      const queue = { text: "", thought: "", frame: null as number | null, done: false };

      const pump = () => {
        queue.frame = null;
        const takeText = queue.done ? queue.text.length : revealCount(queue.text.length);
        const takeThought = queue.done ? queue.thought.length : revealCount(queue.thought.length);
        if (!takeText && !takeThought) return;

        const [shownText, restText] = splitAt(queue.text, takeText);
        const [shownThought, restThought] = splitAt(queue.thought, takeThought);
        queue.text = restText;
        queue.thought = restThought;

        editTurns(into, (prev) => {
          let next = prev;
          const now = Date.now();
          if (shownText) next = applyAcpEvent(next, { kind: "chunk", text: shownText }, false, now);
          if (shownThought) {
            next = applyAcpEvent(next, { kind: "thought", text: shownThought }, false, now);
          }
          return next;
        });

        // 남았으면 계속 돈다 — 도착이 멎어도 대기줄이 빌 때까지 흐른다.
        if (queue.text || queue.thought) queue.frame = requestAnimationFrame(pump);
      };

      const schedule = () => {
        if (queue.frame === null) queue.frame = requestAnimationFrame(pump);
      };

      /** 남은 것을 즉시 다 내보낸다 (순서가 중요한 사건 앞·턴 종료). */
      const drain = () => {
        if (queue.frame !== null) {
          cancelAnimationFrame(queue.frame);
          queue.frame = null;
        }
        queue.done = true;
        if (queue.text || queue.thought) pump();
        queue.done = false;
      };

      const channel = new Channel<AcpEvent>();
      channel.onmessage = (event) => {
        // 이미 다른 대화로 넘어갔어도 **이 대화의 기록에는 계속 쌓인다** —
        // `target` 이 고정돼 있어서, 돌아오면 그 자리에 그대로 있다.
        if (event.kind === "chunk" || event.kind === "thought") {
          if (event.kind === "chunk") queue.text += event.text;
          else queue.thought += event.text;
          schedule();
          return;
        }

        // 텍스트가 아닌 사건(툴콜·승인·종료)은 순서가 중요하다 — 대기줄을 먼저
        // 비우고 나서 적용해야 카드가 문장 앞으로 튀지 않는다.
        drain();
        editTurns(into, (prev) => applyAcpEvent(prev, event, false, Date.now()));
        if (event.kind === "usage") {
          putUsage(into, { used: event.used, size: event.size, costUsd: event.cost_usd });
        } else if (event.kind === "failed") {
          putError(into, event.message);
        } else if (event.kind === "permission") {
          putPermission(into, event);
        } else if (event.kind === "config_changed") {
          // 설정은 **그 대화의 것**이다 — 뒤에서 도는 대화가 모델을 바꿨다고
          // 보고 있던 대화의 셀렉터를 갈아 끼우면 화면이 거짓을 말한다.
          setSession((prev) =>
            prev && (prev.session_id ?? SLATE) === into ? { ...prev, options: event.options } : prev,
          );
        }
      };

      try {
        const res = await commands.acpPrompt(
          projectId,
          into,
          outgoing,
          sending,
          sendingBlocks,
          channel,
        );
        if (res.status === "error") putError(into, tError(res.error));
      } finally {
        drain();
        // 커맨드가 끝났으면 턴도 끝났다 — 이후 도착하는 청크는 받지 않는다.
        // 승인 카드도 함께 치운다: 백엔드가 미결 요청을 취소로 닫았으므로
        // 남겨 두면 눌러도 아무 일이 안 일어나는 유령 카드가 된다.
        editTurns(into, (prev) => closeTurn(prev, Date.now()));
        putPermission(into, null);
        markBusy(into, false);
      }
    },
    [draft, busySessions, projectId, attachments, images, ultracode, activeId, session?.session_id, openSession, newConversation, addTab, editTurns, openInTerminal, markBusy, putError, putUsage, putPermission, t],
  );

  // 턴이 끝나면 그 대화의 큐에서 맨 앞을 꺼내 보낸다. **대화마다 하나씩** —
  // 한 대화 안에서 한꺼번에 밀어 넣으면 사용자가 중간에서 멈출 수 없다.
  //
  // 예전에는 "지금 열려 있는 대화의 것만" 나갔다. 대화가 하나만 돌던 때는 그게
  // 유일하게 안전한 규칙이었다 — 보낼 곳을 백엔드 장부가 정했으니 다른 대화
  // 몫을 꺼내면 오배송이었다. 이제 `send` 가 대화를 직접 짚으므로, 뒤에 있는
  // 대화도 제 턴이 끝나는 대로 줄이 풀린다.
  //
  // `drainingRef` 가 대화별 집합인 이유: 이 effect 는 `send` 의 아이덴티티(=입력할
  // 때마다 바뀐다)에도 걸려 있고 StrictMode 는 effect 를 두 번 돌린다. 가드가
  // 없으면 같은 문장이 두 번 나간다.
  const drainingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const item of queue) {
      const id = item.sessionId ?? SLATE;
      // 아직 만들지 않은 대화(빈 자리)의 줄은 **그 화면을 보고 있을 때만** 푼다 —
      // 안 보는 사이에 세션이 생기고 화면이 그리로 끌려가면 안 된다.
      if (id === SLATE && activeId !== SLATE) continue;
      if (busySessions.has(id) || drainingRef.current.has(id)) continue;
      drainingRef.current.add(id);
      setQueue((prev) => prev.filter((queued) => queued !== item));
      void send(item.text, id).finally(() => {
        drainingRef.current.delete(id);
      });
    }
  }, [busySessions, queue, send, activeId]);

  /** 보고 있는 대화만 멈춘다 — 옆에서 돌던 것은 계속 간다. */
  const cancel = useCallback(() => {
    void commands.acpCancel(projectId, activeId === SLATE ? null : activeId);
    putPermission(activeId, null);
  }, [projectId, activeId, putPermission]);

  /**
   * 목록에서 **열지 않고** 중단 (Phase 3 `#inline-stop`).
   *
   * 지금까지 멈추는 길은 보고 있는 대화의 ESC/정지 버튼뿐이었다 — 뒤에서 도는
   * 대화를 멈추려면 먼저 그리로 옮겨 가야 했고, 옮기는 것 자체가 스트림의
   * 자리를 흔든다. 취소는 세션 id 로 보내면 되므로 갈 이유가 없다.
   */
  const stopSession = useCallback(
    (sessionId: string) => {
      void commands.acpCancel(projectId, sessionId);
      putPermission(sessionId, null);
    },
    [projectId, putPermission],
  );

  // 세션 줄의 상태 — 이 화면이 이미 버스에 쓰고 있으므로 읽기도 여기서 한다.
  const rowStates = useAcpRowStates();
  const rowStateOf = useCallback(
    (sessionId: string) => acpRowStateOf(rowStates, projectId, sessionId),
    [rowStates, projectId],
  );
  /**
   * 활성 대화를 맨 위로. 원장(`stabilizeHistory`)이 정한 순서는 버킷 **안에서**
   * 그대로 살아 있다 — 활성은 그 앞에 붙는 별도 칸일 뿐이다.
   */
  const shownHistory = useMemo(
    () => sortActiveFirst(history ?? EMPTY_SESSIONS, (id) => rowStateOf(id) != null),
    [history, rowStateOf],
  );

  // ESC 로 중단. 화면 어디에 포커스가 있든 먹어야 해서 document 에 건다 —
  // 진행 중일 때만 등록하므로 다른 화면의 ESC(팝오버 닫기 등)를 뺏지 않는다.
  useEffect(() => {
    if (!busy) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // **보이는 화면만 받는다.** 이 화면은 다른 화면으로 옮겨도 살아 있으므로
      // (keep-alive), 안 가리면 오늘 현황에서 팝오버를 닫으려고 누른 ESC 가
      // 뒤에서 돌던 턴을 중단시킨다.
      if (!isVisible()) return;
      e.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [busy, cancel, isVisible]);

  const decide = useCallback((requestId: string, optionId: string | null) => {
    setPermission(null);
    void commands.acpPermissionRespond(requestId, optionId);
  }, []);

  /** ⇧Tab — 안전한 모드들을 순환한다. */
  const cycleMode = useCallback(() => {
    const mode = session?.options.find((o) => o.id === "mode");
    if (!mode) return;
    const at = CYCLE_MODES.indexOf(mode.current as (typeof CYCLE_MODES)[number]);
    // 목록 밖(dontAsk·bypass)에 있었다면 처음으로 되돌린다 — 순환에서 빠져
    // 나오는 길이 없으면 갇힌다.
    const next = CYCLE_MODES[(at + 1) % CYCLE_MODES.length];
    void setOption(mode.id, next);
  }, [session, setOption]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중의 Enter/방향키는 **IME 의 것**이다. 안 거르면 조합을 확정하는
    // Enter 가 문장을 그대로 전송한다 — 한글로 쓰는 사용자가 매일 밟는 지뢰.
    // (일부 엔진이 isComposing 을 늦게 세팅해 keyCode 229 도 같이 본다.)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Tab" && e.shiftKey && !slash?.length && !mentions?.length) {
      e.preventDefault();
      cycleMode();
      return;
    }
    // ↑/↓ — 보냈던 지시 되부르기. 팝오버가 열려 있으면 그쪽 것이고, 커서가
    // 텍스트 한가운데면 **줄 이동**이다 — 맨 앞(↑)·맨 끝(↓)에서만 받는다.
    if (!slash?.length && !mentions?.length) {
      const el = e.currentTarget;
      if (e.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0) {
        const step = recallBack(userPrompts, recallRef.current, draft);
        if (step) {
          e.preventDefault();
          recallRef.current = step.state;
          setDraft(step.text);
        }
        return;
      }
      if (
        e.key === "ArrowDown" &&
        recallRef.current &&
        el.selectionStart === el.value.length &&
        el.selectionEnd === el.value.length
      ) {
        const step = recallForward(userPrompts, recallRef.current);
        if (step) {
          e.preventDefault();
          recallRef.current = step.state;
          setDraft(step.text);
        }
        return;
      }
    }
    if (slash?.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => {
          const next = e.key === "ArrowDown" ? i + 1 : i - 1;
          return (next + slash.length) % slash.length;
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickCommand(slash[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
    }
    // 멘션 목록이 떠 있으면 방향키·엔터는 목록 것이다 — 목록을 두고 전송되면
    // 사용자가 고르려던 파일 대신 반쯤 쓴 문장이 날아간다.
    if (mentions?.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => {
          const next = e.key === "ArrowDown" ? i + 1 : i - 1;
          return (next + mentions.length) % mentions.length;
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentions(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  /**
   * 탭 줄과 지난 대화 패널이 받는 것들 — **스트리밍 중에도 그대로여야 한다.**
   *
   * 둘 다 memo 인데, 여기서 매 렌더 새 배열·새 함수를 만들면 memo 는 한 번도
   * 걸리지 않는다. 특히 패널은 닫혀 있어도 마운트된 채라(전이·스크롤 보존)
   * 목록 전체가 글자마다 다시 조정되고 있었다.
   */
  /**
   * 새 세션을 누르면 **탭 줄에도 그 자리가 생긴다.**
   *
   * 세션은 첫 마디를 보낼 때 비로소 만들어진다(`newConversation` 은 화면만
   * 비운다). 그런데 탭 줄은 `acpTabs` 만 그렸으니, 눌러도 상단바는 방금 떠나온
   * 대화를 그대로 가리키고 있었다 — 새 창이 열린 표시가 어디에도 없었다.
   *
   * `acpTabs` 에 넣지 않고 **여기서만 붙인다**: 그 목록은 디스크에 남는데,
   * 아직 아무것도 아닌 대화가 거기 남으면 다음에 앱을 켰을 때 열 수 없는 탭이
   * 하나 뜬다. 첫 마디와 함께 진짜 탭이 같은 자리(맨 끝)에 들어서므로 바뀌는
   * 순간에도 줄이 흔들리지 않는다.
   */
  const tabItems = useMemo(() => {
    const named = tabs.map((tab) => ({ ...tab, title: nameOf(tab.id, tab.title) }));
    return pending ? [...named, { id: SLATE, title: null, pending: true }] : named;
  }, [tabs, nameOf, pending]);
  const pickSession = useCallback(
    (id: string) => {
      // 아직 안 만든 대화에는 열 것이 없다 (이미 그 자리에 있다).
      if (id === SLATE) return;
      void openSession(id);
    },
    [openSession],
  );

  /**
   * 상단바는 **탭 줄이 곧 제목**이다.
   *
   * 원래 ClaudeCodeScreenV2 가 그렸는데 이리로 내렸다: 탭이 필요로 하는 것
   * (세션 목록·현재 세션·열기·새로 만들기)이 전부 이 컴포넌트 안에 있어서,
   * 위에서 그리려면 그 상태를 통째로 밖으로 끌어내거나 신호선을 새로 놓아야
   * 했다. 툴바를 내리는 쪽이 상태도 신호선도 안 늘린다.
   */
  const toolbar = (
    <Toolbar
      title={
        <AcpSessionTabs
          tabs={tabItems}
          activeId={activeId}
          onPick={pickSession}
          onClose={closeTab}
        />
      }
    >
      <AcpUsageMeter projectId={projectId} />
      {/* 터미널로 나가는 문.
          어댑터는 CLI 가 가진 것 중 **자기가 노출하기로 한 것만** 준다 —
          `/remote-control`·`/login` 처럼 CLI 의 대화형 UI 에 사는 기능은 이
          화면에서 못 닿는다. 그럴 때 같은 프로젝트에서 진짜 `claude` 를 띄운다. */}
      <button
        type="button"
        className="btn icon ghost"
        onClick={() => openInTerminal()}
        aria-label={t("acp.openInTerminal")}
        title={t("acp.openInTerminal")}
      >
        <Terminal size={15} />
      </button>
      <button
        type="button"
        className={"btn icon ghost acp-panel-toggle" + (panelOpen ? " active" : "")}
        onClick={() => setPrefs((prev) => ({ ...prev, acpPanelOpen: !prev.acpPanelOpen }))}
        aria-pressed={panelOpen}
        aria-label={t("acp.history")}
        title={t("acp.history")}
      >
        <PanelLeft size={15} />
      </button>
    </Toolbar>
  );

  if (!session) {
    return (
      <>
      {toolbar}
      <div className="ai-wrap">
        <div className="ai-thread">
          <div className="ai-thread-inner">
            <div className="ai-start">
              <div className="ai-start-title">
                <ClaudeMark size={17} style={{ color: CLAUDE_ORANGE }} aria-hidden="true" />
                {starting ? t("acp.preparing") : t("acp.offTitle")}
              </div>
              <div className="ai-start-sub">{t("acp.offSub")}</div>
              {starting ? null : (
                <div className="ai-start-actions">
                  <button className="btn sm primary" onClick={() => void retry()}>
                    {t("acp.retry")}
                  </button>
                  {/* 문구가 가리키던 "설정 → 통합" 은 없는 경로였다 — 버튼으로. */}
                  <button className="btn sm" onClick={() => openSettings("oculpm")}>
                    {t("acp.openSettings")}
                  </button>
                </div>
              )}
              {error && <div className="msg-error">{error}</div>}
            </div>
          </div>
        </div>
      </div>
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
            /* 시작 화면은 조용해야 한다 — 칩을 늘어놓으면 "무엇을 시킬까"를
               고르는 화면이 되고, 정작 하려던 말을 밀어낸다. 마크 하나와 두
               줄이면 충분하다 (Claude Code 시작 화면 벤치마크). 마크는 제목
               줄에 제 색으로 — 색 상자에 넣어 가운데 띄우는 히어로는 뺐다. */
            <div className="ai-start">
              <div className="ai-start-title">
                <ClaudeMark size={17} style={{ color: CLAUDE_ORANGE }} aria-hidden="true" />
                {t("acp.readyTitle")}
              </div>
              <div className="ai-start-sub">{t("acp.readySub")}</div>
            </div>
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
            /* 어댑터 프로세스가 죽었다. 이 배너가 없으면 마지막 상태가 그대로
               남아 **아무 일도 없는 척**한다 — 보내면 그때서야 오류가 난다. */
            <div className="failure" role="status">
              <span className="failure-icon">
                <TriangleAlert size={13} />
              </span>
              <span className="failure-body">
                <span className="failure-title">{t("acp.agentGone")}</span>
                <span className="failure-details">{t("acp.agentGoneSub")}</span>
              </span>
              <button
                type="button"
                className="btn sm primary failure-act"
                disabled={starting}
                onClick={() => void reconnect()}
              >
                {t("acp.reconnect")}
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="msg assistant">
              <div className="msg-head">
                <TriangleAlert size={13} style={{ color: "var(--t-bug)" }} />
                <span className="msg-model" style={{ color: "var(--t-bug)" }}>
                  {t("ai.errorLabel")}
                </span>
                <span style={{ flex: 1 }} />
                {/* 같은 지시를 다시 보내는 길 — 오류의 답이 "복사해서 다시 치기"
                    면 안 된다. 닫기는 오류를 읽었다는 표시다. */}
                {!busy && lastSentRef.current ? (
                  <button
                    type="button"
                    className="msg-error-act"
                    onClick={() => {
                      setError(null);
                      void send(lastSentRef.current ?? undefined);
                    }}
                  >
                    {t("acp.retrySend")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="msg-error-act"
                  aria-label={t("acp.errorDismiss")}
                  title={t("acp.errorDismiss")}
                  onClick={() => setError(null)}
                >
                  <X size={12} />
                </button>
              </div>
              <div className="msg-error">{error}</div>
            </div>
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

      <div className="ai-compose agent">
        <div className={"composer agent" + (dropActive ? " dropping" : "")}>
          {dropActive ? (
            <div className="composer-drop" aria-hidden="true">
              <Paperclip size={14} />
              {t("acp.dropHint")}
            </div>
          ) : null}
          {queue.length ? (
            <div className="queue-row">
              {/* 이 대화 몫만 보인다 — 다른 대화의 대기분이 여기 떠 있으면
                  "내가 보낸 적 없는 문장"이 붙어 있는 것처럼 읽힌다. */}
              {queue.map((item, i) =>
                (item.sessionId ?? SLATE) !== activeId ? null : (
                  <span key={i} className="queue-chip">
                    <Clock size={11} />
                    {/* 본문 클릭 = **입력창으로 회수** — 잘못 큐에 넣었을 때의
                        정답은 삭제가 아니라 이어서 고치는 것이다. X 만 폐기. */}
                    <button
                      type="button"
                      className="queue-chip-text"
                      title={t("acp.queue.restore")}
                      onClick={() => {
                        setQueue((prev) => prev.filter((_, at) => at !== i));
                        setDraft((prev) => (prev.trim() ? prev : item.text));
                        inputRef.current?.focus();
                      }}
                    >
                      {item.text}
                    </button>
                    <button
                      type="button"
                      className="queue-chip-x"
                      aria-label={t("acp.queue.remove")}
                      title={t("acp.queue.remove")}
                      onClick={() => setQueue((prev) => prev.filter((_, at) => at !== i))}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ),
              )}
            </div>
          ) : null}

          {images.length ? (
            <div className="image-row">
              {/* 보낸 뒤 대화에 남는 칩과 **같은 모양**이다 — 붙일 때와 보낸
                  뒤가 다르게 생기면 같은 것인지 매번 다시 확인해야 한다.
                  누르면 크게 보이고, 지우기는 호버해야 나오는 X 로. */}
              {images.map((image, i) => (
                <span key={i} className="pending-image">
                  <ImageAttachment
                    image={{
                      src: `data:${image.block.mime_type};base64,${image.block.data_base64}`,
                      name: image.name,
                      width: image.width,
                      height: image.height,
                    }}
                  />
                  <button
                    type="button"
                    className="pending-image-x"
                    aria-label={t("acp.image.remove")}
                    title={t("acp.image.remove")}
                    onClick={() => setImages((prev) => prev.filter((_, at) => at !== i))}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {attachments.length ? (
            <div className="attach-row">
              {attachments.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="attach-chip"
                  title={t("acp.attach.remove")}
                  onClick={() => setAttachments((prev) => prev.filter((p) => p !== path))}
                >
                  <span className="attach-chip-name">{path.split("/").pop()}</span>
                  <X size={11} />
                </button>
              ))}
            </div>
          ) : null}

          <div style={{ position: "relative" }}>
            {slash ? (
              <div className="mention" role="listbox" aria-label={t("acp.slash.aria")}>
                {slash.length ? (
                  slash.map((command, i) => (
                    <button
                      key={command.name}
                      type="button"
                      role="option"
                      aria-selected={i === slashIndex}
                      className={"settings-row" + (i === slashIndex ? " active" : "")}
                      onMouseEnter={() => setSlashIndex(i)}
                      onClick={() => pickCommand(command)}
                    >
                      <span className="settings-row-icon">
                        <Terminal size={13} />
                      </span>
                      <span className="settings-row-body">
                        <span className="settings-row-name">
                          /{command.name}
                          {command.hint ? (
                            <span className="slash-hint"> {command.hint}</span>
                          ) : null}
                        </span>
                        {command.description ? (
                          <span className="settings-row-desc">{command.description}</span>
                        ) : null}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="mention-empty">{t("acp.slash.empty")}</div>
                )}
              </div>
            ) : null}

            {mentions ? (
              <div className="mention" role="listbox" aria-label={t("acp.mention.aria")}>
                {mentions.length ? (
                  mentions.map((path, i) => {
                    const name = path.split("/").pop() ?? path;
                    return (
                      <button
                        key={path}
                        type="button"
                        role="option"
                        aria-selected={i === mentionIndex}
                        className={"mention-item" + (i === mentionIndex ? " active" : "")}
                        onMouseEnter={() => setMentionIndex(i)}
                        onClick={() => pickMention(path)}
                      >
                        <span className="mention-name">{name}</span>
                        <span>{path}</span>
                      </button>
                    );
                  })
                ) : (
                  <div className="mention-empty">{t("acp.mention.empty")}</div>
                )}
              </div>
            ) : null}

            {/* `.composer-input` 은 **래퍼** 클래스다 — textarea 에 직접 걸면
                스타일이 하나도 먹지 않는다(초기 구현의 실수). */}
            <div className="composer-input">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder={busy ? t("acp.placeholderBusy") : t("acp.placeholder")}
              aria-label={t("acp.inputAria")}
              onChange={(e) => {
                // 손으로 고치기 시작하면 되부르기는 끝난 것이다 — 다음 ↑ 는
                // 다시 가장 최근부터.
                recallRef.current = null;
                setDraft(e.target.value);
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
            />
            </div>
          </div>

          <div className="composer-foot">
            <button
              type="button"
              className="btn icon ghost"
              onClick={() => void attach()}
              aria-label={t("acp.attach.add")}
              title={t("acp.attach.add")}
            >
              <Paperclip size={14} />
            </button>
            <span style={{ flex: 1 }} />
            {/* 노브 묶음은 **한 덩어리로 접힌다**.
                창을 좁히면 이 줄이 압착되면서 "7% · $0.30" 이 두 줄로 꺾이고
                보내기 버튼이 카드 밖으로 밀려났다. 클립·중지·보내기는 자리를
                지키고, 가운데만 가로로 도망가게 한다 (툴바와 같은 수법). */}
            <div className="composer-knobs">
            {/* 사용량 표시가 곧 버튼이다 — 숫자를 보다가 "자세히"를 누르고
                싶어지는 자리가 바로 여기다. */}
            {/* 이 대화가 컨텍스트를 얼마나 먹었는지. 계정 한도는 툴바 계기의
                몫이라 여기서는 **이 대화 이야기만** 한다. */}
            {usage ? (
              <button
                type="button"
                className="usage-btn"
                onClick={() => requestUsagePanel()}
                title={t("acp.usageTitle")}
              >
                {Math.round((usage.used / Math.max(usage.size, 1)) * 100)}%
                {usage.costUsd != null ? ` · $${usage.costUsd.toFixed(2)}` : ""}
              </button>
            ) : null}
            {PRIMARY_CONFIG_IDS.map((id) => {
              const option = session.options.find((o) => o.id === id);
              if (!option) return null;
              // Effort 만 슬라이더다 — 값에 **순서**가 있기 때문. 순서 있는
              // 값을 목록으로 고르게 하면 "지금이 어느 정도인지"가 안 보인다.
              return id === "effort" ? (
                <EffortControl
                  key={id}
                  option={option}
                  onChange={setOption}
                  ultracode={ultracode}
                  onUltracode={(on) =>
                    setPrefs((prev) => ({ ...prev, acpUltracode: on }))
                  }
                  ultraReady={supportsUltracode(
                    session.options.find((o) => o.id === "model")?.current,
                  )}
                />
              ) : (
                <ConfigControl key={id} option={option} onChange={setOption} />
              );
            })}
            <MoreSettings
              options={session.options.filter(
                (o) => !PRIMARY_CONFIG_IDS.includes(o.id as (typeof PRIMARY_CONFIG_IDS)[number]),
              )}
              onChange={setOption}
            />
            </div>
            {busy ? (
              <button
                type="button"
                className="btn icon composer-stop"
                onClick={cancel}
                aria-label={t("acp.cancelEsc")}
                title={t("acp.cancelEsc")}
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : null}
            <button
              type="button"
              className="btn icon composer-send"
              disabled={!draft.trim()}
              onClick={() => void send()}
              aria-label={busy ? t("acp.queueSend") : t("acp.send")}
              title={busy ? t("acp.queueSend") : t("acp.send")}
            >
              <ArrowUp size={13} />
            </button>
          </div>
        </div>
      </div>
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
        onStop={stopSession}
      />

    </div>
    </>
  );
}
