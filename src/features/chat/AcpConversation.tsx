import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Channel } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  ClipboardCheck,
  Clock,
  Copy,
  ExternalLink,
  File as FileIcon,
  Flame,
  Lock,
  Play,
  Rocket,
  Settings,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import { Toolbar } from "@/components/Toolbar";
import { PanelLeft } from "@/components/Icons";
import { ClaudeMark, CLAUDE_ORANGE } from "@/components/ClaudeMark";
import { AcpUsageMeter } from "./AcpUsageMeter";
import {
  commands,
  type AcpConfigOption,
  type AcpEvent,
  type AcpImage,
  type AcpCommand,
  type AcpSession,
  type AcpSessionSummary,
} from "@/lib/bindings";
import { useT } from "@/i18n";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  applyAcpEvent,
  closeTurn,
  groupTurns,
  insertNotice,
  openTurn,
  turnReceipt,
  fileChangeDiscrepancy,
  type AcpBlock,
  type AcpPlanEntry,
  type AcpToolCall,
  type AcpTurn,
  type AcpTurnImage,
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
import { nextIndex, withUltracode } from "./ultracode";
import { requestUsagePanel } from "./usageBus";
import { acpWorkingKey, setAcpAttention, setAcpWorking } from "./acpBusyBus";
import { recallBack, recallForward, type RecallState } from "./promptHistory";
import { AcpDiffView } from "./AcpDiffView";
import { diffLines, diffStats } from "./lineDiff";
import { markSpoken, stabilizeHistory, type ActivityLedger } from "./acpHistory";
import { revealCount, splitAt } from "./streamPacer";
import { registerCloseHandler } from "@/lib/closeIntent";
import { registerBusy } from "@/lib/busyGuard";
import {
  claudeCommand,
  newPtySessionId,
  stageBootCommand,
} from "@/features/terminal/terminalLaunch";
import { AcpSessionTabs } from "./AcpSessionTabs";
import { typedLength, wordDurationMs, wordKeyAt } from "./agentWords";
import { estimateTokens } from "@/lib/tokenEstimate";
import { splitMarkdownBlocks } from "./markdownBlocks";
import { relativeTime } from "./relativeTime";
import { PEEK_IN_LINES, PEEK_OUT_LINES, peekLines } from "./tracePreview";
import { useDismiss } from "./useDismiss";

/** 아직 안 만든 새 대화의 기록이 머무는 자리 (`session_id` 가 아직 없다). */
const SLATE = "";

/** 빈 기록의 **한 개짜리** 배열 — 매 렌더 새 배열을 만들면 memo 가 다 깨진다. */
const EMPTY_TURNS: AcpTurn[] = [];

/** 같은 이유의 빈 목록 (아직 대화 목록을 못 읽었을 때). */
const EMPTY_SESSIONS: AcpSessionSummary[] = [];

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

interface UsageState {
  used: number;
  size: number;
  costUsd: number | null;
}

type PermissionState = Extract<AcpEvent, { kind: "permission" }>;

/** 도구 종류 → 아이콘. 모르는 종류는 중립 아이콘으로 흘린다. */
const TOOL_ICON: Readonly<Record<string, typeof FileIcon>> = {
  read: FileIcon,
  edit: Pencil,
  delete: Trash2,
  move: ArrowRight,
  search: Search,
  execute: Terminal,
  think: Sparkles,
  fetch: ExternalLink,
};

/** 상태 → i18n 키. 모르는 상태는 원문 그대로 보여 준다(삼키지 않는다). */
const TOOL_STATUS_KEY = {
  pending: "acp.tool.status.pending",
  in_progress: "acp.tool.status.inProgress",
  completed: "acp.tool.status.completed",
  failed: "acp.tool.status.failed",
} as const;

export function AcpConversation({ projectId }: { projectId: number }) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const panelOpen = state.acpPanelOpen;
  /**
   * 사용자가 붙인 이름표. **우리 쪽에만 있다** — 프로토콜에 제목을 고치는
   * 요청이 없어서(있는 것은 지우기뿐) 에이전트의 제목은 그대로 두고 화면에서만
   * 우리 이름이 이긴다. 그래서 이 이름은 이 컴퓨터를 벗어나지 않는다.
   */
  const names = state.acpNames;
  const nameOf = useCallback(
    (id: string | null, fallback: string | null) => (id ? (names[id] ?? fallback) : fallback),
    [names],
  );
  const ultracode = state.acpUltracode;
  const tabs = state.acpTabs;

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
      setState((prev) =>
        prev.acpTabs.some((tab) => tab.id === id)
          ? prev
          : { ...prev, acpTabs: [...prev.acpTabs, { id, title }] },
      );
    },
    [setState],
  );

  /** 제목만 갱신 — **없는 탭을 만들지 않는다**(그게 되살아남의 통로였다). */
  const renameTab = useCallback(
    (id: string | null, title: string | null) => {
      if (!id || title === null) return;
      setState((prev) => {
        const at = prev.acpTabs.findIndex((tab) => tab.id === id);
        if (at === -1 || prev.acpTabs[at].title === title) return prev;
        const next = [...prev.acpTabs];
        next[at] = { id, title };
        return { ...prev, acpTabs: next };
      });
    },
    [setState],
  );
  const [session, setSession] = useState<AcpSession | null>(null);
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
      setTranscripts((prev) => ({ ...prev, [id]: update(prev[id] ?? []) }));
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
  const activeId = session?.session_id ?? SLATE;
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
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageState | null>(null);
  /**
   * 승인 대기 중인 권한 요청. 응답할 때까지 **에이전트는 멈춰 있다** — 그래서
   * 카드를 모달이 아니라 대화 흐름에 인라인으로 둔다(D4). 모달로 가리면
   * 무엇을 승인하는지 보여 주는 도구 카드가 함께 가려진다.
   */
  const [permission, setPermission] = useState<PermissionState | null>(null);
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
   * 에이전트가 도는 동안 사용자가 친 메시지. 턴이 끝나면 차례로 나간다.
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
        else setError(res.error);
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

  /**
   * 설정을 주기적으로 되읽는다.
   *
   * 모델을 바꾸면 어댑터가 **권한 모드를 조용히 내릴 수 있다**(새 모델이 그
   * 모드를 지원하지 않을 때). 그 사실은 우리 요청의 응답이 아니라 알림으로
   * 오므로, 되읽지 않으면 "Auto" 라 적힌 채 실제로는 Manual 로 도는 상태가
   * 된다 — 사용자가 자동 승인될 거라 믿는 순간이라 그냥 두면 안 된다.
   */
  useEffect(() => {
    if (!session) return;
    const sync = () => {
      // 안 보이는 동안에는 되읽지 않는다 — 이 값들은 **화면에만** 쓰이고,
      // 화면이 keep-alive 로 살아 있는 한 이 타이머는 영원히 돈다. 돌아오면
      // 다음 tick(≤4초)이 알아서 따라잡는다.
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
        if (res.status === "ok" && res.data.length) {
          setSession((prev) => (prev ? { ...prev, options: res.data } : prev));
        }
      });
      // 제목은 에이전트가 대화를 보고 **나중에** 붙인다 — 같은 주기로 따라간다.
      // 아직 안 만든 새 대화(`session_id === null`)에서는 건너뛴다: 백엔드에는
      // 직전 대화가 남아 있어서 그 제목이 빈 화면에 되살아난다.
      if (session?.session_id == null) return;
      void commands.acpSessionTitle(projectId).then((res) => {
        if (res.status === "ok") {
          setSession((prev) =>
            prev && prev.title !== res.data ? { ...prev, title: res.data } : prev,
          );
        }
      });
    };
    const timer = window.setInterval(sync, 4000);
    return () => window.clearInterval(timer);
  }, [projectId, session, isVisible]);


  // 지금 보고 있는 대화를 기억해 둔다 — 다시 띄웠을 때 여기로 돌아온다.
  useEffect(() => {
    const id = session?.session_id ?? null;
    setState((prev) => (prev.acpLastSession === id ? prev : { ...prev, acpLastSession: id }));
  }, [session?.session_id, setState]);

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
    const key = acpWorkingKey(projectId, session?.session_id ?? null);
    setAcpAttention(key, permission != null);
    return () => setAcpAttention(key, false);
  }, [permission, projectId, session?.session_id]);

  /**
   * 파일 드래그&드롭 → 첨부.
   *
   * HTML 드롭은 Tauri 가 가로채므로(웹뷰 기본) OS 드롭은 **Tauri 이벤트**로만
   * 받을 수 있다. 이 화면이 보일 때만 받는다 — keep-alive 로 배경에 살아 있는
   * 다른 프로젝트 탭이 드롭을 삼키면 안 된다.
   */
  const projectRoot = state.currentProjectRoot;
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
  useEffect(() => {
    renameTab(session?.session_id ?? null, session?.title ?? null);
  }, [session?.session_id, session?.title, renameTab]);


  /**
   * 답변이 도는 동안은 **업데이트 재시작을 막는다.**
   *
   * 재시작은 우리가 띄운 어댑터를 같이 죽이고, 그때 흐르던 답변은 아직 디스크에
   * 없어 그대로 사라진다. 새 번들을 까는 것까지는 언제든 해도 된다 — 기다리는
   * 것은 마지막 한 걸음뿐이다.
   */
  useEffect(() => registerBusy(() => (busy ? t("acp.busyReason") : null)), [busy, t]);

  /**
   * 사이드바에 "몇 개가 돌고 있는지"를 알린다.
   *
   * 이 화면을 떠나도 턴은 계속 돈다 — 그런데 떠난 순간부터 **아무 표시도 없다**.
   * 다 됐는지 보려고 되돌아오는 일이 반복됐다. 언마운트(창을 닫거나 프로젝트
   * 탭을 접을 때)에도 반드시 지운다: 안 지우면 끝나지 않는 유령이 남는다.
   */
  useEffect(() => {
    const key = acpWorkingKey(projectId, session?.session_id ?? null);
    setAcpWorking(key, busy);
    return () => setAcpWorking(key, false);
  }, [busy, projectId, session?.session_id]);

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
      else setError(res.error);
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
        setError(res.error);
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
      setHistory(stabilizeHistory(res.data, activityRef.current, removedRef.current));
    }
  }, [projectId]);

  // 패널을 안 열어도 목록을 읽는다. **탭 제목이 여기서 온다** — 세션 제목은
  // 에이전트가 대화를 보고 붙이고 그 알림은 만든 직후 한 번뿐이라, 지난 대화를
  // 열면 알림이 다시 오지 않아 탭이 영영 "제목 없는 대화"로 남았다. 목록은
  // 어댑터가 들고 있는 **완성된 제목**을 언제든 준다.
  useEffect(() => {
    if (!session) return;
    void refreshHistory();
  }, [session, refreshHistory]);

  // 목록의 제목으로 탭을 메운다 (이름표를 붙인 탭은 건드리지 않는다 — 그쪽이 이긴다).
  useEffect(() => {
    if (!history?.length) return;
    setState((prev) => {
      let changed = false;
      const next = prev.acpTabs.map((tab) => {
        const found = history.find((item) => item.id === tab.id);
        if (!found?.title || found.title === tab.title) return tab;
        changed = true;
        return { ...tab, title: found.title };
      });
      return changed ? { ...prev, acpTabs: next } : prev;
    });
  }, [history, setState]);

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
      setUsage(null);
      setPermission(null);
      setError(null);

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
        else setError(picked.error);
        return;
      }

      editTurns(sessionId, () => []);

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
        setError(res.error);
      }
    },
    [projectId, addTab, editTurns, tabs],
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
        setError(res.error);
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
    const last = state.acpLastSession;
    if (!last || last === session.session_id) return;
    if (!history.some((item) => item.id === last)) return;
    void openSession(last);
  }, [session, history, state.acpLastSession, openSession]);

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
    setUsage(null);
    setPermission(null);
    setError(null);
    // 새 대화를 연 다음 할 일은 하나뿐이다 — 입력. 클릭 한 번을 아껴 준다.
    inputRef.current?.focus();
  }, [editTurns]);

  /**
   * 같은 프로젝트에서 진짜 `claude` 를 터미널에 띄운다.
   *
   * 여기(ACP)로 못 닿는 기능이 있을 때의 탈출구다. 새 셸을 열고 첫 명령을
   * 등록해 두면, 그 셸이 뜨는 순간 `TerminalInstance` 가 한 번만 쳐 준다.
   */
  const openInTerminal = useCallback((prefill?: string) => {
    const id = newPtySessionId(state.currentProjectId);
    stageBootCommand(id, claudeCommand(prefill));
    setState((prev) => ({
      ...prev,
      terminalTabs: [
        ...prev.terminalTabs,
        {
          id,
          label: "Claude Code",
          shell: "",
          cwd: prev.currentProjectRoot ?? "",
        },
      ],
      terminalActiveId: id,
      uiV2View: "terminal",
    }));
  }, [state.currentProjectId, setState]);

  /**
   * 탭을 닫는다. **보고 있던 탭이면 다른 탭으로 옮겨 간다** — 안 그러면 탭은
   * 없는데 그 대화가 화면에 그대로 남고, 그 상태에서 말을 걸면 방금 닫은 탭이
   * 되살아난다("닫아도 안 닫힌다"의 정체).
   */
  const closeTab = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        acpTabs: prev.acpTabs.filter((tab) => tab.id !== id),
      }));
      if (session?.session_id !== id) return;
      const rest = tabs.filter((tab) => tab.id !== id);
      if (rest.length) void openSession(rest[rest.length - 1].id);
      else newConversation();
    },
    [session?.session_id, tabs, openSession, newConversation, setState],
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
        if (!current || !tabs.some((tab) => tab.id === current)) return false;
        closeTab(current);
        return true;
      }),
    [session?.session_id, tabs, closeTab],
  );

  /**
   * 이름표를 붙인다(빈 문자열이면 뗀다). 에이전트에게는 보내지 않는다 —
   * 프로토콜에 제목을 고치는 요청이 없다.
   */
  const rename = useCallback(
    (sessionId: string, next: string) => {
      const label = next.trim();
      setState((prev) => {
        const names = { ...prev.acpNames };
        if (label) names[sessionId] = label;
        else delete names[sessionId];
        return { ...prev, acpNames: names };
      });
    },
    [setState],
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
        setError(res.error);
        return;
      }
      // 어댑터 목록은 잠깐 더 이 대화를 들고 있다 — 우리 쪽에서 못 박아 둔다.
      removedRef.current.add(sessionId);
      setState((prev) => {
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
    [projectId, refreshHistory, session?.session_id, newConversation, setState],
  );

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      if (!text) return;

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
            setError(res.error);
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

      if (busy) {
        setQueue((prev) => [...prev, { text, sessionId: session?.session_id ?? null }]);
        setDraft("");
        recallRef.current = null;
        return;
      }

      // 울트라코드 칸이 켜져 있으면 키워드를 함께 보낸다 — 어댑터가 우리
      // 턴을 human 으로 스탬프하므로 CLI 의 opt-in 게이트를 통과한다.
      // 보내는 순간부터 이 화면은 새 세대다 — 아직 흐르고 있는 재생분이
      // 내 질문 위에 지난 대화를 덧그리면 안 된다.
      loadSeqRef.current += 1;
      // 아직 안 만든 새 대화라면 **지금** 만든다 (새 대화 버튼은 화면만 비운다).
      // 백엔드의 `acp_prompt` 는 세션이 없으면 알아서 하나 파지만, 여기서는
      // 직전 대화가 아직 등록돼 있어서 그냥 보내면 **그 대화에 이어 붙는다.**
      let target = session?.session_id ?? null;
      if (!target) {
        const opened = await commands.acpNewSession(projectId);
        if (opened.status !== "ok") {
          setError(opened.error);
          return;
        }
        setSession(opened.data);
        target = opened.data.session_id;
        // 빈 자리에 있던 기록은 이제 이 대화의 것이다.
        if (target) {
          const id = target;
          setTranscripts((prev) => ({ ...prev, [id]: prev[SLATE] ?? [], [SLATE]: [] }));
        }
      }
      // 여기까지 왔는데 id 가 없으면 보낼 곳이 없다 — 조용히 나가면 입력만
      // 사라지고 아무 일도 안 일어난 것처럼 보인다.
      if (!target) {
        setError(t("acp.sendNoSession"));
        return;
      }
      const into = target;

      // 이 대화에 실제로 말을 걸었다 — 이제 진짜로 가장 최근이다.
      markSpoken(activityRef.current, into, new Date().toISOString());
      addTab(into, session?.title ?? null);
      const outgoing = withUltracode(text, ultracode);
      const sending = attachments;
      const sendingImages = images;
      const sendingBlocks: AcpImage[] = images.map((image) => image.block);
      lastSentRef.current = text;
      recallRef.current = null;
      setDraft("");
      setAttachments([]);
      setImages([]);
      setMentions(null);
      setSlash(null);
      setError(null);
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
      // 내가 방금 말을 걸었다 — 어디를 보고 있었든 이제 바닥이 관심사다.
      stickRef.current = true;
      setBusy(true);

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
          setUsage({ used: event.used, size: event.size, costUsd: event.cost_usd });
        } else if (event.kind === "failed") {
          setError(event.message);
        } else if (event.kind === "permission") {
          setPermission(event);
        } else if (event.kind === "config_changed") {
          setSession((prev) => (prev ? { ...prev, options: event.options } : prev));
        }
      };

      try {
        const res = await commands.acpPrompt(projectId, outgoing, sending, sendingBlocks, channel);
        if (res.status === "error") setError(res.error);
      } finally {
        drain();
        // 커맨드가 끝났으면 턴도 끝났다 — 이후 도착하는 청크는 받지 않는다.
        // 승인 카드도 함께 치운다: 백엔드가 미결 요청을 취소로 닫았으므로
        // 남겨 두면 눌러도 아무 일이 안 일어나는 유령 카드가 된다.
        editTurns(into, (prev) => closeTurn(prev, Date.now()));
        setPermission(null);
        setBusy(false);
      }
    },
    [draft, busy, projectId, attachments, images, ultracode, session?.session_id, session?.title, openSession, newConversation, addTab, editTurns, openInTerminal, t],
  );

  // 턴이 끝나면 큐의 맨 앞을 꺼내 보낸다. **한 번에 하나씩** — 한꺼번에 밀어
  // 넣으면 사용자가 중간에서 멈출 수 없다.
  //
  // `drainingRef` 가 필요한 이유: 이 effect 는 `send` 의 아이덴티티(=입력할
  // 때마다 바뀐다)에도 걸려 있고 StrictMode 는 effect 를 두 번 돌린다. 가드가
  // 없으면 같은 문장이 두 번 나갈 수 있다.
  const drainingRef = useRef(false);
  useEffect(() => {
    if (busy || drainingRef.current) return;
    // **지금 열려 있는 대화의 것만** 나간다 — 다른 대화 몫은 그 대화로 돌아올
    // 때까지 기다린다. 큐에 남아 있는 한 화면(그 대화의 컴포저)에 계속 보인다.
    const at = queue.findIndex((item) => (item.sessionId ?? SLATE) === activeId);
    if (at === -1) return;
    drainingRef.current = true;
    const next = queue[at];
    setQueue((prev) => prev.filter((_, i) => i !== at));
    void send(next.text).finally(() => {
      drainingRef.current = false;
    });
  }, [busy, queue, send, activeId]);

  const cancel = useCallback(() => {
    void commands.acpCancel(projectId);
    setPermission(null);
  }, [projectId]);

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
  const tabItems = useMemo(
    () => tabs.map((tab) => ({ ...tab, title: nameOf(tab.id, tab.title) })),
    [tabs, nameOf],
  );
  const pickSession = useCallback(
    (id: string) => {
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
          activeId={session?.session_id ?? null}
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
        onClick={() => setState((prev) => ({ ...prev, acpPanelOpen: !prev.acpPanelOpen }))}
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
            <div className="ai-hero">
              <div className="ai-hero-icon claude">
                <ClaudeMark size={26} style={{ color: CLAUDE_ORANGE }} />
              </div>
              <div className="ai-hero-title">
                {starting ? t("acp.preparing") : t("acp.offTitle")}
              </div>
              <div className="ai-hero-sub">{t("acp.offSub")}</div>
              {starting ? null : (
                <div className="ai-suggest">
                  <button className="ai-suggest-chip" onClick={() => void retry()}>
                    {t("acp.retry")}
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
               줄이면 충분하다 (Claude Code 시작 화면 벤치마크). */
            <div className="ai-hero acp-hero">
              <div className="ai-hero-icon claude">
                <ClaudeMark size={26} style={{ color: CLAUDE_ORANGE }} />
              </div>
              <div className="ai-hero-title">{t("acp.readyTitle")}</div>
              <div className="ai-hero-sub">{t("acp.readySub")}</div>
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
                    setState((prev) => ({ ...prev, acpUltracode: on }))
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
        sessions={history ?? EMPTY_SESSIONS}
        currentId={session.session_id}
        query={historyQuery}
        onQuery={setHistoryQuery}
        onPick={pickSession}
        onNew={newConversation}
        onRename={rename}
        onDelete={remove}
        names={names}
      />

    </div>
    </>
  );
}

/** 완성된 블록 하나 — 문자열이 그대로면 다시 파싱하지 않는다. */
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return <Markdown>{text}</Markdown>;
});

/** 스트리밍 중 본문 — 블록 단위로 그린다 (markdownBlocks.ts 참고). */
function StreamingMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(text), [text]);
  return (
    <>
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} text={block} />
      ))}
    </>
  );
}

/**
 * 턴 한 줄. **memo 인 이유**: 스트리밍 중에는 마지막 턴만 바뀌는데, memo 가
 * 없으면 매 갱신마다 지난 턴의 마크다운까지 전부 다시 파싱된다 — 대화가 길수록
 * 심해져 "렉 걸린 타자"처럼 보인다. 리듀서가 바뀐 턴만 새 객체로 만들기 때문에
 * 기본 얕은 비교로 충분하다.
 */
/**
 * 보낸 이미지 한 장 — 파일 이름과 원본 픽셀 크기를 달고, 누르면 크게 본다.
 *
 * 대화에 원본을 그대로 박지 않는 이유: 스크린샷은 대개 대화 폭보다 크고,
 * 통째로 깔면 그 뒤의 지시문이 화면 밖으로 밀린다. 목록에서는 **무엇을
 * 붙였는지만** 알면 되고, 실제로 보고 싶을 때는 그때 크게 연다.
 */
function ImageAttachment({ image }: { image: AcpTurnImage }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="user-file image"
        onClick={() => setOpen(true)}
        title={t("acp.image.view")}
      >
        <img className="user-file-thumb" alt="" src={image.src} />
        <span className="user-file-name">{image.name}</span>
        {image.width > 0 ? (
          <span className="user-file-dim">
            {image.width}×{image.height}
          </span>
        ) : null}
      </button>
      {open ? <Lightbox image={image} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** 크게 보기. Escape·바깥 클릭으로 닫힌다. */
function Lightbox({ image, onClose }: { image: AcpTurnImage; onClose: () => void }) {
  const { t } = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 대화 화면의 Escape 는 "생성 중단"이다 — 여기까지 내려가면 보던 것을
        // 닫으려다 작업이 멎는다. 이 창이 떠 있는 동안은 우리가 먹는다.
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <figure className="lightbox-frame" onClick={(e) => e.stopPropagation()}>
        <img className="lightbox-img" alt={image.name} src={image.src} />
        <figcaption className="lightbox-cap">
          <span className="lightbox-name">{image.name}</span>
          {image.width > 0 ? (
            <span className="lightbox-dim">
              {image.width}×{image.height}
            </span>
          ) : null}
        </figcaption>
      </figure>
      <button
        type="button"
        className="lightbox-close"
        onClick={onClose}
        aria-label={t("acp.image.close")}
        title={t("acp.image.close")}
      >
        <X size={16} />
      </button>
    </div>,
    document.body,
  );
}

/** 지시문을 몇 줄까지 접어 둘지 — 넘으면 "펼치기"가 붙는다. */
const USER_CLAMP_LINES = 6;

/**
 * 사용자 지시 한 덩어리.
 *
 * 말풍선이 아니라 **카드**다. 말풍선은 오른쪽으로 밀리고 폭이 좁아 긴 지시문이
 * 계단처럼 꺾이는데, 여기서 쓰는 것은 한 줄 대꾸가 아니라 번호 붙은 요구사항
 * 묶음이다. 딸려 보낸 것도 같은 카드에 담겨야 "이 지시에 이 사진"이 한
 * 덩어리로 읽힌다.
 *
 * 길면 접는다. 지시문이 길수록 답도 길어서, 안 접으면 화면 위쪽을 지시문이 다
 * 먹고 정작 보려던 출력이 밀려난다.
 */
function UserTurn({ turn }: { turn: AcpTurn }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);

  // 접힌 상태에서만 잰다 — 펼친 뒤에는 넘칠 것이 없어 `false` 가 되고,
  // 그러면 "접기" 버튼이 스스로 사라져 되돌릴 방법이 없어진다.
  useLayoutEffect(() => {
    if (expanded) return;
    const el = textRef.current;
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [expanded, turn.text]);

  return (
    <div className={"msg user" + (expanded ? " expanded" : "")}>
      <div
        className={"user-card" + (clipped && !expanded ? " clipped" : "")}
        // 펼치기는 **본문 어디를 눌러도** 된다 (작은 버튼을 겨냥할 필요 없이).
        // 접기는 버튼으로만 — 본문 클릭으로 접으면 긴 글을 읽다가 스크롤 대신
        // 잘못 눌렀을 때 읽던 자리가 통째로 사라진다.
        onClick={clipped && !expanded ? () => setExpanded(true) : undefined}
      >
        {/* 언제 시켰나 — 작업 콘솔인데 시각이 어디에도 없었다. 호버에만 보인다
            (상시 노출은 카드마다 숫자 벽지가 된다). 재생으로 복원한 턴에는
            시각이 없어 조용히 빠진다. */}
        {turn.at != null ? (
          <span className="user-card-time">
            {new Date(turn.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
        {turn.images?.length || turn.attachments?.length ? (
          <div className="user-card-files">
            {turn.images?.map((image, i) => (
              <ImageAttachment key={`i${i}`} image={image} />
            ))}
            {turn.attachments?.map((path) => (
              <span key={path} className="user-file" title={path}>
                <FileIcon size={12} />
                <span className="user-file-name">{path.split("/").pop()}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div
          ref={textRef}
          className="user-card-text"
          style={expanded ? undefined : { maxHeight: `calc(${USER_CLAMP_LINES} * 1.65em)` }}
        >
          {turn.text}
        </div>
        {clipped ? (
          <button
            type="button"
            className="user-card-more"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? t("acp.user.less") : t("acp.user.more")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 할 일 목록 — 진행 중인 것 하나가 눈에 먼저 들어와야 한다. */
function PlanList({ entries }: { entries: readonly AcpPlanEntry[] }) {
  const { t } = useT();
  const done = entries.filter((entry) => entry.status === "completed").length;

  return (
    <details className="plan" open>
      <summary>
        <ChevronDown size={12} />
        <span className="plan-title">{t("acp.plan.title")}</span>
        <span className="plan-count">{t("acp.plan.count", { done, total: entries.length })}</span>
      </summary>
      <ul className="plan-list">
        {entries.map((entry, i) => (
          <li key={i} className={"plan-item " + entry.status}>
            <span className="plan-mark" aria-hidden="true" />
            <span className="plan-text">{entry.content}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * 세션에 일어난 일 — 한도 초과·인증 실패·모델 폴백.
 *
 * 어시스턴트가 쓴 글이 아니고 지나가는 배너도 아니다. **대화에 남는 기록**이라
 * (스펙의 표현 그대로) 일어난 자리에 그대로 둔다.
 */
function FailureRow({
  block,
}: {
  block: Extract<AcpBlock, { kind: "failure" }>;
}) {
  const warning = block.severity === "warning";
  return (
    <div className={"failure" + (warning ? " warning" : "")} role="status">
      <span className="failure-icon">
        {warning ? <AlertTriangle size={13} /> : <TriangleAlert size={13} />}
      </span>
      <span className="failure-body">
        <span className="failure-title">{block.title}</span>
        {block.details ? <span className="failure-details">{block.details}</span> : null}
      </span>
    </div>
  );
}

const TurnRow = memo(function TurnRow({
  turn,
  live,
}: {
  turn: AcpTurn;
  live: boolean;
}) {
  const { t } = useT();

  if (turn.role === "user") return <UserTurn turn={turn} />;

  // 구분선은 **받은 문장을 그대로** 건다. 예전엔 여기서 "…로 전환"을 붙였는데,
  // 그러면 모델 교체 말고는 아무 것도 이 자리에 못 넣는다 — 대화에 일어나는
  // 일은 그것만이 아니다.
  if (turn.role === "notice") {
    return (
      <div className="turn-notice" role="separator">
        <span className="turn-notice-label">{turn.text}</span>
      </div>
    );
  }

  // 옛 기록(블록 이전)도 그려야 한다 — 글 한 덩어리로 폴백한다.
  const blocks: AcpBlock[] =
    turn.blocks ?? (turn.text ? [{ kind: "text", text: turn.text }] : []);

  const receipt = turnReceipt(turn);
  // 에이전트가 신고한 파일 변경이 추론 영수증과 어긋날 때만 한 줄 더 붙인다.
  const discrepancy = fileChangeDiscrepancy(turn);

  return (
    <div className={"msg assistant" + (live ? " streaming" : "")}>
      {/* 이름을 적지 않는다 — 답이 하나뿐인 화면에서 매 턴 "Claude Agent" 를
          반복하면 정보가 아니라 소음이다.

          진행 표시용 점도 따로 두지 않는다. 레일이 이미 단계마다 점을 찍고 그
          중 도는 것은 맥박이 뛴다 — 위에 점 하나를 더 얹으면 점이 두 개가 되고,
          "빚는 중…" 같은 상태 문구와 **줄이 갈라진다**. 점은 그 문구의 줄에
          있어야 둘이 한 말로 읽힌다. */}
      {/* 답 전체 복사 — 코드펜스에는 이미 복사가 있지만 "답을 통째로"는
          긁어서 고르는 수밖에 없었다. 끝난 턴에만 — 흐르는 글의 복사는 반쪽이다. */}
      {!live && turn.text.trim() ? <TurnCopy text={turn.text} /> : null}
      {turn.thought ? (
        <details className="think">
          <summary>
            <ChevronDown size={12} />
            <ThinkingLabel turn={turn} live={live} />
          </summary>
          <div className="think-body msg-md">
            <Markdown>{turn.thought}</Markdown>
          </div>
        </details>
      ) : null}
      {/* 할 일 목록은 조각 흐름 **위**에 하나로 둔다 — 진행 상황을 훑는 물건이라
          글·도구 더미 아래에 두면 긴 턴에서 매번 스크롤로 찾아야 한다. 매 갱신에
          전체가 새로 오므로 이 자리에서 통째로 바뀐다. */}
      {turn.plan?.length ? <PlanList entries={turn.plan} /> : null}
      {/* 글과 도구를 **온 순서 그대로** 그린다. 예전엔 도구를 전부 위에, 글을
          전부 아래에 모아 그려서 — 도구 사이사이에 한 줄씩 하던 설명이 맨
          아래에 줄줄이 붙어 서로 다른 대목의 문장이 한 문단처럼 이어졌다. */}
      {blocks.map((block, i) =>
        block.kind === "tool" ? (
          <TraceRow key={block.call.id} tool={block.call} />
        ) : block.kind === "failure" ? (
          <FailureRow key={block.id} block={block} />
        ) : (
          <div className="msg-md" key={`t${i}`}>
            {/* 스트리밍 중에도 **서식이 바로 보인다.** 평문으로 뒀다 끝에
                포맷하면 점프가 생기고, 매 프레임 전체를 파싱하면 끊긴다 —
                둘 다 겪었다. 블록으로 쪼개면 완성된 블록은 문자열이 안 바뀌어
                memo 가 재파싱을 건너뛰고, 매번 다시 파싱되는 건 마지막 블록
                하나뿐이라 비용이 문단 길이에 묶인다.

                **마지막 조각만** 스트리밍 취급한다 — 앞의 것들은 이미 끝났다. */}
            {live && i === blocks.length - 1 ? (
              <StreamingMarkdown text={block.text} />
            ) : (
              <Markdown>{block.text}</Markdown>
            )}
          </div>
        ),
      )}
      {/* 턴 영수증 — 이 턴이 실제로 무엇을 했는지 한 줄. 일지 제품의 DNA 를
          대화 표면에 남기는 자리다. 도구를 쓴 턴에만 — "도구 0" 은 소음이다. */}
      {receipt ? (
        <div className="turn-receipt">
          {[
            t("acp.receipt.tools", { n: receipt.tools }),
            receipt.files ? t("acp.receipt.files", { n: receipt.files }) : null,
            receipt.commands ? t("acp.receipt.commands", { n: receipt.commands }) : null,
            receipt.seconds == null
              ? null
              : receipt.seconds < 60
                ? t("acp.receipt.sec", { s: receipt.seconds })
                : receipt.seconds % 60 === 0
                  ? t("acp.receipt.min", { m: Math.floor(receipt.seconds / 60) })
                  : t("acp.receipt.minSec", {
                      m: Math.floor(receipt.seconds / 60),
                      s: receipt.seconds % 60,
                    }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
      {/* 에이전트가 직접 신고한 파일 변경 — 도구 흔적으로 센 영수증과 다를
          때만 나온다. 같은 수를 두 번 적으면 소음이라, 어긋남 자체가 정보다.
          (명령이나 자식 프로세스가 바꾼 파일은 편집 도구 호출로 안 잡힌다.) */}
      {discrepancy ? (
        <div className="turn-receipt turn-receipt-audit" title={t("acp.audit.why")}>
          {discrepancy.kind === "extra"
            ? t("acp.audit.extra", {
                declared: discrepancy.declared,
                inferred: discrepancy.inferred,
              })
            : discrepancy.kind === "partial"
              ? discrepancy.uncertainty
                ? t("acp.audit.partialWhy", {
                    n: discrepancy.declared,
                    why: discrepancy.uncertainty,
                  })
                : t("acp.audit.partial", { n: discrepancy.declared })
              : t("acp.audit.missing", { reason: discrepancy.reason })}
        </div>
      ) : null}
      {blocks.length === 0 ? (
        live ? (
          <AgentWord />
        ) : (
          <div className="msg-wait">{t("acp.waiting")}</div>
        )
      ) : null}
    </div>
  );
});

/** 끝난 답변의 전체 복사 버튼 — 호버에만 보인다 (상시 노출은 벽지가 된다). */
function TurnCopy({ text }: { text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 클립보드가 없는 환경 — 조용히 지나간다 */
    }
  }, [text]);
  return (
    <button
      type="button"
      className={"turn-copy" + (copied ? " done" : "")}
      onClick={() => void copy()}
      aria-label={t("acp.copyTurn")}
      title={t("acp.copyTurn")}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

/**
 * 도구 호출 한 단계 — 무엇을 시켰고, 무엇이 나왔나.
 *
 * 예전에는 끝나면 한 줄로 접혀서, 스무 번 도구를 쓴 대화가 **똑같이 생긴 스무
 * 줄**이 됐다. 무엇이 나왔는지는 하나씩 펼쳐야 알 수 있었고, 그래서 아무도
 * 안 펼쳤다. 반대로 전문을 다 펼치면 수백 줄짜리 출력이 답변을 화면 밖으로
 * 밀어낸다.
 *
 * 그 사이를 고른다: **결과의 머리 몇 줄을 항상 보여 주고**(tracePreview.ts),
 * 아래를 페이드로 잘라 더 있음을 알린다. 누르면 들어간 것(IN)과 나온 것(OUT)
 * 전문이 열린다. 훑기만 해도 흐름이 읽히고, 파고들 때만 자리를 내준다.
 */
const TraceRow = memo(function TraceRow({ tool }: { tool: AcpToolCall }) {
  const { t } = useT();
  const running = tool.status === "in_progress" || tool.status === "pending";
  const failed = tool.status === "failed";
  /**
   * 접힘/펼침은 사용자가 정하되, **기본값은 진행 중이면 펼침**이다. 돌고 있는
   * 동안에는 "무엇을 시켰는지"가 곧 진행 상황이다. `null` 은 "아직 안 건드림".
   */
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? running;
  const Icon = TOOL_ICON[tool.kind] ?? Code2;
  const statusKey = TOOL_STATUS_KEY[tool.status as keyof typeof TOOL_STATUS_KEY];
  const state = running ? " running" : failed ? " failed" : "";
  const expandable = Boolean(tool.input || tool.output || tool.diffs?.length);

  /**
   * 변경 규모("+12 −3") — 펼치기 전에 줄에서 바로 읽힌다. 어떤 파일을 몇 줄
   * 고쳤는지가 이 카드의 핵심 정보인데, 예전엔 펼쳐야만 보였다.
   */
  const diffTotals = useMemo(() => {
    if (!tool.diffs?.length) return null;
    let added = 0;
    let removed = 0;
    for (const diff of tool.diffs) {
      const stats = diffStats(diffLines(diff.old_text, diff.new_text));
      added += stats.added;
      removed += stats.removed;
    }
    return { added, removed };
  }, [tool.diffs]);

  /**
   * 미리보기 — 명령(IN)의 머리 두 줄과 결과(OUT)의 머리 네 줄.
   *
   * **IN 은 명령을 실행한 단계에서만** 보여 준다. 줄에 적히는 제목은 모델이
   * 쓴 설명("ACP 백엔드의 취소 경로 찾기")이라 실제로 무엇이 돌았는지는 여기
   * 말고는 볼 데가 없다. 반대로 읽기·편집은 대상 경로가 이미 줄에 있어서
   * 같은 것을 두 번 적는 꼴이 된다 — 그 자리는 결과에 내준다.
   */
  const peek = useMemo(() => {
    const wantsInput = Boolean(tool.input) && (tool.kind === "execute" || !tool.output);
    const input = wantsInput ? peekLines(tool.input ?? "", PEEK_IN_LINES) : null;
    const output = tool.output ? peekLines(tool.output, PEEK_OUT_LINES) : null;
    return {
      input,
      output,
      empty: !input?.text && !output?.text,
      truncated: Boolean(input?.truncated || output?.truncated),
      hidden: (input?.hiddenLines ?? 0) + (output?.hiddenLines ?? 0),
    };
  }, [tool.output, tool.input, tool.kind]);

  const status = statusKey ? t(statusKey) : tool.status;

  return (
    <div className={"trace-item" + (open ? " open" : "")}>
      <button
        type="button"
        className={"trace-row" + state}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setChoice(!open)}
      >
        <span className="trace-icon">
          <Icon size={13} />
        </span>
        {/* 이름과 설명을 가른다. 예전엔 명령줄 전체가 제목 자리에 들어가서,
            줄이 길수록 "무슨 도구였나"가 말줄임 뒤로 사라졌다. 이름은 짧고
            늘 같은 자리에 있어야 훑을 때 걸린다 (Claude Code 벤치마크). */}
        <span className="trace-name">{tool.name || t("acp.tool.untitled")}</span>
        <span className="trace-title">{tool.subtitle || tool.title}</span>
        {tool.locations.length ? (
          <span className="trace-path" title={tool.locations.join("\n")}>
            {tool.locations[0]}
          </span>
        ) : null}
        {tool.locations.length > 1 ? (
          <span className="trace-more">+{tool.locations.length - 1}</span>
        ) : null}
        {/* 변경 규모는 상태와 무관하게 늘 보인다 — "무엇을 얼마나 고쳤나"가
            이 줄의 존재 이유다. */}
        {diffTotals ? (
          <span className="trace-diffstat">
            {diffTotals.added ? <span className="add">+{diffTotals.added}</span> : null}
            {diffTotals.removed ? <span className="del">−{diffTotals.removed}</span> : null}
          </span>
        ) : null}
        {/* 상태 글자는 **말할 것이 있을 때만**. 스무 줄에 "완료"가 스무 번
            적혀 있으면 그건 정보가 아니라 벽지다 — 끝난 단계는 아무 말도 하지
            않는 것이 곧 "잘 끝났다"이고, 눈은 그 사이의 빨강만 찾으면 된다.
            눈에서 지우는 것과 **없애는 것**은 다르다: 읽어 주는 기계에는 늘
            남는다 (`.trace-sr`). */}
        {running || failed ? (
          <span className="trace-status">
            {status}
            {/* 도는 단계는 경과가 붙는다 — 30초째 도는 Bash 와 방금 시작한
                Bash 가 같은 얼굴이면 멈춘 것인지 판단할 근거가 없다. */}
            {running ? <TraceElapsed since={tool.startedAt} /> : null}
          </span>
        ) : (
          <span className="trace-sr">{status}</span>
        )}
        {/* 접혀 있고 더 있으면 얼마나 더 있는지. 펼치기 전에 "이걸 펼칠 가치가
            있나"를 판단할 유일한 근거다. */}
        {!open && peek.hidden > 0 ? (
          <span className="trace-count">{t("acp.tool.moreLines", { n: peek.hidden })}</span>
        ) : null}
        {/* 캐럿은 없어도 **자리는 지킨다** — 캐럿 유무에 따라 오른쪽 열이
            들쭉날쭉하면 스무 줄이 줄맞춤을 잃는다. */}
        <ChevronDown size={12} className={"trace-caret" + (expandable ? "" : " ghost")} />
      </button>
      {open ? (
        <div className="trace-body">
          {tool.input ? <TraceIo tag="IN" text={tool.input} /> : null}
          {/* 편집 도구의 본론 — 무엇이 어떻게 바뀌었나. */}
          {tool.diffs?.length ? <AcpDiffView diffs={tool.diffs} /> : null}
          {tool.output ? <TraceIo tag="OUT" text={tool.output} /> : null}
        </div>
      ) : tool.diffs?.length ? (
        // 접힌 편집 카드는 diff 머리를 보여 준다 — 텍스트 미리보기와 같은 이유,
        // 같은 동작(누르면 펼침).
        <div
          className="trace-peek"
          aria-hidden="true"
          onClick={() => {
            if (window.getSelection()?.toString()) return;
            setChoice(true);
          }}
        >
          <AcpDiffView diffs={tool.diffs} compact />
        </div>
      ) : peek.empty ? null : (
        // 미리보기도 누르면 펼쳐진다 — 잘린 글을 보고 손이 가는 자리가 여기다.
        // 줄과 **같은 동작**을 하므로 보조기기에는 하나만 보이게 감춘다.
        <div
          className={"trace-peek" + (peek.truncated ? " clipped" : "") + (failed ? " failed" : "")}
          aria-hidden="true"
          // 글자를 끌어 고르고 손을 뗀 것도 클릭이다 — 오류 메시지를 복사하려던
          // 참에 블록이 펼쳐지며 자리가 밀리면 고른 것이 어디 갔는지 잃는다.
          onClick={() => {
            if (window.getSelection()?.toString()) return;
            setChoice(true);
          }}
        >
          {peek.input?.text ? (
            <div className="trace-io">
              <span className="trace-io-tag">IN</span>
              <pre>{peek.input.text}</pre>
            </div>
          ) : null}
          {peek.output?.text ? (
            <div className="trace-io">
              <span className="trace-io-tag">OUT</span>
              <pre>{peek.output.text}</pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

/** 도는 단계의 경과 초 — 1초마다 다시 그린다 (그 단계가 도는 동안만). */
function TraceElapsed({ since }: { since?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (since == null) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (since == null) return null;
  const sec = Math.max(0, Math.round((Date.now() - since) / 1000));
  // 첫 1~2초는 적지 않는다 — 모든 단계에 "· 0s" 가 붙으면 벽지가 된다.
  if (sec < 3) return null;
  return <span className="trace-elapsed"> · {sec}s</span>;
}

/**
 * 펼친 본문의 IN/OUT 한 칸 — 호버에 복사가 뜬다.
 *
 * 도구 출력은 이 화면에서 가장 자주 **다른 곳으로 가져가는** 글이다(오류
 * 메시지를 검색하고, 명령을 다시 치고). 긁어 고르기가 유일한 길이면 안 된다.
 */
function TraceIo({ tag, text }: { tag: string; text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 클립보드가 없는 환경 */
    }
  }, [text]);
  return (
    <div className="trace-io">
      <span className="trace-io-tag">{tag}</span>
      <pre>{text}</pre>
      <button
        type="button"
        className={"trace-io-copy" + (copied ? " done" : "")}
        onClick={() => void copy()}
        aria-label={t("acp.copyIo")}
        title={t("acp.copyIo")}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  );
}

/**
 * 승인 카드. 응답할 때까지 에이전트가 멈춰 있으므로 **닫기 버튼을 두지 않는다** —
 * 카드를 그냥 없애면 에이전트가 영영 기다린다. 나가는 길은 선택지뿐.
 */
function PermissionCard({
  request,
  onDecide,
}: {
  request: PermissionState;
  onDecide: (requestId: string, optionId: string | null) => void;
}) {
  const { t } = useT();
  // 어댑터는 선택지 순서를 보장하지 않는다 — 실측(2026-08-14)에서 `Deny` 가
  // **첫 항목**으로 왔다. 강조는 순서가 아니라 kind 로 고르고, 우리 폴백 거절
  // 버튼은 어댑터가 거절 선택지를 안 줬을 때만 낸다(중복 방지).
  const hasReject = request.options.some((option) => option.option_kind.startsWith("reject"));
  const Icon = TOOL_ICON[request.tool_kind] ?? Code2;
  // 명령 실행·삭제는 편집보다 대가가 크다 — 카드의 낯빛이 달라야 손이 느려진다.
  const risky = request.tool_kind === "execute" || request.tool_kind === "delete";

  return (
    <div
      className={"perm" + (risky ? " danger" : "")}
      role="group"
      aria-label={t("acp.perm.title")}
      // 승인 카드는 에이전트가 **멈추는 유일한 순간**이다 — 읽어 주는 기계에도
      // 도착이 알려져야 한다. 포커스는 뺏지 않는다: 컴포저에 치던 Enter 가
      // 허용 버튼 위에서 눌리는 사고가 더 나쁘다.
      aria-live="polite"
    >
      <div className="perm-head">
        <TriangleAlert size={13} />
        {t("acp.perm.title")}
      </div>
      <div className="perm-what">
        <Icon size={14} style={{ color: "var(--text-3)", flex: "none" }} />
        <span className="perm-title">{request.title || t("acp.tool.untitled")}</span>
        {request.locations.length ? (
          <span className="perm-path" title={request.locations.join("\n")}>
            {request.locations[0]}
            {request.locations.length > 1 ? ` +${request.locations.length - 1}` : ""}
          </span>
        ) : null}
      </div>
      {/* **무엇을 허용하는지가 카드 안에 있다.** 예전엔 제목과 경로뿐이라
          내용을 보려면 위의 도구 카드를 스스로 찾아 펼쳐야 했다 — 사실상
          블라인드 승인이었다. 실행이면 명령을, 편집이면 diff 를 그대로 보인다. */}
      {request.input ? (
        <div className="perm-payload">
          <div className="trace-io">
            <span className="trace-io-tag">IN</span>
            <pre>{request.input}</pre>
          </div>
        </div>
      ) : null}
      {request.diffs.length ? (
        <div className="perm-payload">
          <AcpDiffView diffs={request.diffs} />
        </div>
      ) : null}
      <div className="perm-actions">
        {request.options.map((option) => (
          <button
            key={option.id}
            // "이번만 허용"만 초록이다. "항상 허용"은 영구 권한 부여라 1회
            // 허용과 같은 무게로 빛나면 안 된다.
            className={
              "btn sm " +
              (option.option_kind === "allow_once"
                ? "primary"
                : option.option_kind.startsWith("allow")
                  ? "perm-always"
                  : "ghost")
            }
            onClick={() => onDecide(request.request_id, option.id)}
          >
            {option.name}
          </button>
        ))}
        {hasReject ? null : (
          <button className="btn sm ghost" onClick={() => onDecide(request.request_id, null)}>
            {t("acp.perm.reject")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 울트라코드 칸의 가상 값.
 *
 * 어댑터의 effort 목록은 `low·medium·high·xhigh·max` 다섯 개이고 울트라코드는
 * **거기 없다** — 사용자 쪽 Claude Code 는 `max` **다음** 칸에 두고 "xhigh +
 * workflows" 라 설명한다. 즉 effort 값이 아니라 키워드로 켜지는 상태다.
 *
 * 그래서 트랙에 칸 하나를 덧대고, 고르면 effort 는 `xhigh` 로 두고 키워드를
 * 켠다. (앞선 라운드에 `max` 를 울트라코드로 이름만 바꿔 놓았는데, 그러면
 * max 가 사라져 실제로 고를 수 없었다.)
 */
const ULTRA_VALUE = "__ultracode__";

/** 울트라코드가 대응하는 실제 effort 값. */
const ULTRA_EFFORT = "xhigh";

/**
 * 울트라코드를 켤 수 있는 모델인가.
 *
 * 워크플로는 서브에이전트를 여럿 굴리는 일이라 작은 모델에서는 의미가 없다
 * (그리고 사용자 관찰상 상위 모델에서만 켜진다). 값 목록을 우리가 들고 있지
 * 않으므로 **모델 id 로 판정**한다 — 새 상위 모델이 나와도 이름에 opus/fable
 * 이 들어가면 자동으로 통과한다.
 */
function supportsUltracode(model: string | null | undefined): boolean {
  if (!model) return false;
  const id = model.toLowerCase();
  return id.includes("opus") || id.includes("fable") || id === "default";
}

/** 자주 쓰는 설정 3종은 바깥에 — 나머지는 `⋯` 안으로. */
const PRIMARY_CONFIG_IDS = ["mode", "model", "effort"] as const;

/** 컨트롤 트리거에 붙일 아이콘. */
const CONFIG_ICON: Readonly<Record<string, typeof Lock>> = {
  mode: Lock,
  model: Sparkles,
  effort: Flame,
};

/**
 * 권한 모드 선택지별 아이콘. 모드는 **무엇을 허용하는가**라서 이름만으로는
 * 구분이 느리다 — 자물쇠/코드/계획/로켓이 훨씬 빨리 읽힌다.
 */
const MODE_ICON: Readonly<Record<string, typeof Lock>> = {
  default: Lock,
  acceptEdits: Code2,
  plan: ClipboardCheck,
  auto: Rocket,
  dontAsk: Play,
  bypassPermissions: AlertTriangle,
};

/**
 * 모드별 색.
 *
 * 권한 모드는 **틀리면 대가가 큰** 설정이라, 지금 무엇인지가 글자를 읽기 전에
 * 보여야 한다. 위험이 커질수록 차가운 색에서 뜨거운 색으로 간다 — 자물쇠(회색)
 * → 편집 허용(초록) → 계획(파랑) → 자동(보라) → 안 묻기(주황) → 전면 우회(빨강).
 */
// 색은 전부 토큰을 지난다 — 생 hex 는 다크·프리셋 테마에서 채도 보정을 못
// 받아 홀로 이질적으로 뜬다 (파랑=회청 토큰, 보라=리팩터 토큰이 의미도 맞다).
const MODE_COLOR: Readonly<Record<string, string>> = {
  default: "var(--text-2)",
  acceptEdits: "var(--accent)",
  plan: "var(--t-chore)",
  auto: "var(--t-refactor)",
  dontAsk: "var(--t-error)",
  bypassPermissions: "var(--t-bug)",
};

/**
 * ⇧Tab 이 도는 모드들 — 안전한 넷만.
 *
 * 어댑터는 여섯을 주지만 `dontAsk` 와 `bypassPermissions` 는 **되돌릴 수 없는
 * 일을 묻지 않고 하는** 모드다. 키 하나를 연타하다 거기 착지하면 사고다.
 * 메뉴에서는 여전히 고를 수 있다 — 명시적으로 고르는 것과 실수로 지나가는
 * 것은 다르다. (VS Code 확장이 넷만 보여 주는 것도 같은 이유로 읽힌다.)
 */
const CYCLE_MODES = ["default", "acceptEdits", "plan", "auto"] as const;

function choicesOf(option: AcpConfigOption) {
  return option.is_boolean
    ? [
        { value: "true", name: "On", description: null },
        { value: "false", name: "Off", description: null },
      ]
    : option.choices;
}

/**
 * 설정 하나를 여는 컨트롤.
 *
 * 메뉴 행은 **아이콘 + 이름 + 설명** 두 줄이다. 설명은 우리가 지어내지 않고
 * 어댑터가 준 것을 그대로 쓴다("Standard behavior, prompts for dangerous
 * operations"). 모드처럼 결과가 위험할 수 있는 선택은 이름만으로 부족하다.
 */
function ConfigControl({
  option,
  onChange,
  compact,
}: {
  option: AcpConfigOption;
  onChange: (configId: string, value: string) => void;
  /** true 면 트리거에 값 텍스트 없이 아이콘만 (오버플로 안에서 쓸 때). */
  compact?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  const choices = choicesOf(option);
  if (!choices.length) return null;

  const current = choices.find((c) => c.value === option.current);
  // 모드는 **고른 값**이 아이콘을 정한다. 항목 id 로 정하면 Auto 를 골라도
  // 자물쇠(Manual)가 그대로 남는다 — 실제로 그렇게 보였다.
  const TriggerIcon =
    (option.id === "mode" ? MODE_ICON[option.current ?? ""] : undefined) ??
    CONFIG_ICON[option.id];

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"agent-chip" + (open ? " open" : "")}
        // 좁아질 때 **무엇부터 접을지**를 CSS 가 고를 수 있게 종류를 실어 둔다
        // (agent.css 의 컨테이너 쿼리). 모드와 effort 는 아이콘이 색·모양으로
        // 값을 말하지만, 모델은 아이콘이 하나뿐이라 이름이 마지막까지 남아야 한다.
        data-config={option.id}
        aria-haspopup="menu"
        aria-expanded={open}
        title={option.name}
        onClick={() => setOpen((v) => !v)}
      >
        {TriggerIcon ? (
          <TriggerIcon
            size={13}
            style={option.id === "mode" ? { color: MODE_COLOR[option.current ?? ""] } : undefined}
          />
        ) : null}
        {compact ? null : (
          <span
            className="agent-chip-label"
            style={option.id === "mode" ? { color: MODE_COLOR[option.current ?? ""] } : undefined}
          >
            {current?.name ?? option.current}
          </span>
        )}
      </button>
      {open ? (
        <div className="settings-menu" role="menu" aria-label={option.name}>
          <div className="settings-group-label">
            {option.name}
            {option.id === "mode" ? (
              <span className="settings-group-hint">{t("acp.modeCycleHint")}</span>
            ) : null}
          </div>
          {choices.map((choice) => {
            const RowIcon = option.id === "mode" ? MODE_ICON[choice.value] : undefined;
            return (
              <button
                key={choice.value}
                type="button"
                role="menuitemradio"
                aria-checked={choice.value === option.current}
                className={"settings-row" + (choice.value === option.current ? " active" : "")}
                onClick={() => {
                  setOpen(false);
                  onChange(option.id, choice.value);
                }}
              >
                <span
                  className="settings-row-icon"
                  style={
                    option.id === "mode" ? { color: MODE_COLOR[choice.value] } : undefined
                  }
                >
                  {RowIcon ? <RowIcon size={15} /> : null}
                </span>
                <span className="settings-row-body">
                  <span className="settings-row-name">{choice.name}</span>
                  {choice.description ? (
                    <span className="settings-row-desc">{choice.description}</span>
                  ) : null}
                </span>
                {choice.value === option.current ? <Check size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 자주 쓰지 않는 나머지 설정(Fast mode·서브에이전트 …). */
function MoreSettings({
  options,
  onChange,
}: {
  options: AcpConfigOption[];
  onChange: (configId: string, value: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  if (!options.length) return null;

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"agent-chip" + (open ? " open" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("acp.settings")}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings size={13} />
      </button>
      {open ? (
        <div className="settings-menu" role="menu" aria-label={t("acp.settings")}>
          {options.map((option) => (
            <section key={option.id} className="settings-group">
              <div className="settings-group-label">{option.name}</div>
              {choicesOf(option).map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.value === option.current}
                  className={"settings-row" + (choice.value === option.current ? " active" : "")}
                  onClick={() => {
                    setOpen(false);
                    onChange(option.id, choice.value);
                  }}
                >
                  <span className="settings-row-icon" />
                  <span className="settings-row-body">
                    <span className="settings-row-name">{choice.name}</span>
                    {choice.description ? (
                      <span className="settings-row-desc">{choice.description}</span>
                    ) : null}
                  </span>
                  {choice.value === option.current ? <Check size={14} /> : null}
                </button>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 지난 대화 패널.
 *
 * **우리가 저장하지 않는다** — Claude Code 가 이미 자기 세션 스토어를 갖고
 * 있고 ACP `session/list` 가 그걸 열어 준다. 사본을 두면 터미널에서 연 세션과
 * 앱에서 연 세션이 갈라진다. 목록은 **이 프로젝트 경로의 것만** 들어온다
 * (백엔드가 cwd 로 한 번 더 거른다).
 *
 * 팝오버가 아니라 접히는 패널인 이유: 대화를 고르는 일은 "잠깐 열어 보고
 * 닫는" 동작이 아니라 **옆에 두고 오가는** 동작이다.
 */
const SessionPanel = memo(function SessionPanel({
  open,
  sessions,
  currentId,
  query,
  onQuery,
  onPick,
  onNew,
  onRename,
  onDelete,
  names,
}: {
  open: boolean;
  sessions: AcpSessionSummary[];
  currentId: string | null;
  query: string;
  onQuery: (next: string) => void;
  onPick: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, next: string) => void;
  onDelete: (id: string) => void;
  names: Readonly<Record<string, string>>;
}) {
  const { t } = useT();
  /** 지금 이름을 고치고 있는 줄. 한 번에 하나만 — 여러 줄이 동시에 열리면
      어느 것을 저장하는지 알 수 없다. */
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  /**
   * 삭제 대기 중인 줄 — **두 번 눌러야 지워진다.**
   *
   * 삭제는 영구인데(어댑터의 `session/delete`) 22px 버튼이 이름 바꾸기 바로
   * 옆에 있었다. 오클릭 한 번 = 대화 소실. 모달은 과하다 — 같은 자리에서 잠깐
   * "삭제?"로 바뀌었다 2.5초면 돌아오는 것으로 충분하다.
   */
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(null), 2500);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  // 목록 전체가 **같은 기준 시각**을 써야 렌더 도중 분이 넘어가며 순서가
  // 흔들리지 않는다.
  const now = useMemo(() => Date.now(), [sessions]);
  const needle = query.trim().toLowerCase();
  const titleOf = (item: AcpSessionSummary) => names[item.id] ?? item.title ?? "";
  // 이름표를 붙인 대화는 **그 이름으로** 찾을 수 있어야 한다 — 붙여 놓고 원래
  // 제목으로만 검색되면 이름표가 반쪽이다.
  const shown = needle
    ? sessions.filter((item) => titleOf(item).toLowerCase().includes(needle))
    : sessions;

  return (
    <aside
      className={"acp-panel" + (open ? "" : " closed")}
      aria-label={t("acp.history")}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="acp-panel-inner">
      <div className="acp-panel-head">
        <span className="acp-panel-title">{t("acp.history")}</span>
      </div>

      {/* busy 로 잠그지 않는다 — 다른 대화가 도는 동안에도 새 대화는 열 수
          있어야 한다 (기록은 대화별로 갈라져 있고, 전송은 큐가 줄 세운다). */}
      <button type="button" className="acp-panel-new" onClick={onNew}>
        <Plus size={14} />
        {t("acp.newConversation")}
      </button>

      <div className="acp-panel-search">
        <Search size={12} />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("acp.searchSessions")}
          aria-label={t("acp.searchSessions")}
        />
        {query ? (
          <button
            type="button"
            className="acp-search-clear"
            aria-label={t("acp.searchClear")}
            title={t("acp.searchClear")}
            onClick={() => onQuery("")}
          >
            <X size={11} />
          </button>
        ) : null}
      </div>

      <div className="acp-panel-list">
        {shown.length ? (
          shown.map((item) => {
            const label = titleOf(item);
            if (editing?.id === item.id) {
              // 고치는 중에는 줄 전체가 입력칸이 된다 — 좁은 패널에서 인라인
              // 입력칸을 따로 끼워 넣으면 제목이 두 글자만 남는다.
              const commit = () => {
                onRename(item.id, editing.value);
                setEditing(null);
              };
              return (
                <div key={item.id} className="acp-session editing">
                  <input
                    className="acp-session-input"
                    autoFocus
                    value={editing.value}
                    aria-label={t("acp.session.rename")}
                    onChange={(e) => setEditing({ id: item.id, value: e.target.value })}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEditing(null);
                      }
                    }}
                  />
                </div>
              );
            }
            return (
              <div
                key={item.id}
                className={"acp-session" + (item.id === currentId ? " active" : "")}
              >
                <button
                  type="button"
                  className="acp-session-main"
                  onClick={() => onPick(item.id)}
                  title={label || undefined}
                >
                  <span className="acp-session-title">
                    {label || t("acp.untitledSession")}
                  </span>
                  <span className="acp-session-time">
                    {relativeTime(item.updated_at, now)}
                  </span>
                </button>
                <span className="acp-session-actions">
                  {confirming === item.id ? (
                    <button
                      type="button"
                      className="acp-session-confirm"
                      onClick={() => {
                        setConfirming(null);
                        onDelete(item.id);
                      }}
                    >
                      {t("acp.session.confirmDelete")}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="acp-session-act"
                        onClick={() => setEditing({ id: item.id, value: label })}
                        aria-label={t("acp.session.rename")}
                        title={t("acp.session.rename")}
                      >
                        <Pencil size={12} />
                      </button>
                      {/* X 는 "닫기"로 읽힌다 (탭의 X 가 실제로 그렇다) — 영구
                          삭제는 쓰레기통이어야 한다. */}
                      <button
                        type="button"
                        className="acp-session-act danger"
                        onClick={() => setConfirming(item.id)}
                        aria-label={t("acp.session.delete")}
                        title={t("acp.session.delete")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })
        ) : (
          <div className="acp-panel-empty">
            {sessions.length ? t("acp.history.noMatch") : t("acp.history.empty")}
          </div>
        )}
      </div>
      </div>
    </aside>
  );
});

/**
 * Effort — 평소엔 **현재 값만** 보이고, 누르면 트랙이 열린다.
 *
 * 트랙을 항상 펼쳐 두면 컴포저 바닥에서 가장 시끄러운 물체가 되는데, 정작
 * 자주 바꾸는 값은 아니다. 값에 순서가 있으므로 열렸을 때는 목록이 아니라
 * 트랙으로 — 위치가 곧 강도다.
 *
 * `default` 선택지는 뺀다. 실제 기본이 `xhigh` 라 "Default" 와 "Xhigh" 가
 * 같은 것을 두 이름으로 부르는 꼴이고, 고르면 무엇이 되는지 알 수 없다.
 */
function EffortControl({
  option,
  onChange,
  ultracode,
  onUltracode,
  ultraReady,
}: {
  option: AcpConfigOption;
  onChange: (configId: string, value: string) => void;
  ultracode: boolean;
  onUltracode: (on: boolean) => void;
  /** 울트라코드를 켤 수 있는 모델인지 (아니면 마지막 칸이 잠긴다). */
  ultraReady: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  // 열리면 슬라이더로 포커스를 옮긴다 — 그래야 방향키·Tab 이 **값**을 움직인다.
  // 안 옮기면 Tab 이 포커스를 팝오버 밖으로 던져 버린다.
  useEffect(() => {
    if (open) sliderRef.current?.focus();
  }, [open]);

  /** 칸 하나를 고른다. 울트라코드 칸은 effort 를 xhigh 로 두고 키워드를 켠다. */
  const onPick = (value: string) => {
    if (value === ULTRA_VALUE) {
      // 못 켜는 모델이면 아무 일도 하지 않는다 — 켠 척하면 사용자는 워크플로가
      // 돌 거라 믿고 기다린다.
      if (!ultraReady) return;
      onUltracode(true);
      if (option.current !== ULTRA_EFFORT) onChange(option.id, ULTRA_EFFORT);
      return;
    }
    onUltracode(false);
    onChange(option.id, value);
  };

  // 어댑터 값 뒤에 울트라코드 칸을 덧댄다 — max 는 그대로 남는다.
  const choices = useMemo(
    () => [
      ...option.choices.filter((c) => c.value !== "default"),
      {
        value: ULTRA_VALUE,
        name: t("acp.ultracode"),
        description: ultraReady ? t("acp.ultracodeHint") : t("acp.ultracodeNeedsModel"),
      },
    ],
    [option.choices, t, ultraReady],
  );
  if (choices.length < 2) return null;

  // 현재 값이 `default` 로 와도 사용자에게는 실제 동작인 xhigh 로 보인다.
  const effortValue = option.current === "default" ? ULTRA_EFFORT : option.current;
  const currentValue = ultracode ? ULTRA_VALUE : effortValue;
  const index = Math.max(
    0,
    choices.findIndex((c) => c.value === currentValue),
  );
  const current = choices[index];

  const move = (delta: number) => {
    const at = nextIndex(
      index,
      delta,
      choices.length,
      (i) => choices[i].value === ULTRA_VALUE && !ultraReady,
    );
    if (at !== index) onPick(choices[at].value);
  };

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"agent-chip" + (open ? " open" : "")}
        // 단계를 **데이터로** 실어 색은 CSS 가 고른다 — 값 목록이 어댑터에서
        // 오므로, 색 표를 JS 에 두면 값이 하나 늘 때 두 곳을 고쳐야 한다.
        data-effort={currentValue}
        data-config="effort"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={option.name}
        onClick={() => setOpen((v) => !v)}
      >
        <Flame size={13} />
        <span className="agent-chip-label">{current?.name ?? currentValue}</span>
      </button>
      {open ? (
        <div className="settings-menu effort-menu" role="dialog" aria-label={option.name}>
          <div className="settings-group-label">{option.name}</div>
          <div
            className="effort"
            ref={sliderRef}
            role="slider"
            tabIndex={0}
            aria-label={option.name}
            aria-valuemin={0}
            aria-valuemax={choices.length - 1}
            aria-valuenow={index}
            aria-valuetext={current?.name}
            onKeyDown={(e) => {
              // 팝오버가 열려 있는 동안 Tab 은 포커스 이동이 아니라 **값 이동**
              // 이다 — 이 순간 사용자가 하려는 일은 그것뿐이다.
              if (e.key === "Tab") {
                e.preventDefault();
                move(e.shiftKey ? -1 : 1);
                return;
              }
              if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          >
            {/* 값이 위, 트랙이 아래 — 눈이 "지금 무엇"을 먼저 읽고 그 다음
                "어디쯤"을 본다. 나란히 놓으면 둘이 서로를 밀어낸다. */}
            <span
              className={"effort-label" + (currentValue === ULTRA_VALUE ? " top" : "")}
              data-effort={currentValue}
            >
              {current?.name ?? currentValue}
              {/* 울트라코드가 "무엇의 준말인지"를 이름 옆에 붙여 둔다 — 여섯 칸
                  중 유일하게 척도의 연장이 아니라 별개의 물건이라, 설명 없이는
                  max 다음의 더 센 칸으로 오해된다. */}
              {currentValue === ULTRA_VALUE ? (
                <span className="effort-label-note">{t("acp.ultracodeSub")}</span>
              ) : null}
            </span>
            <span className="effort-track">
              {/* 지나온 구간을 선으로 먼저 깔면 "어디쯤"이 점을 세기 전에
                  읽힌다. 점은 그 위의 눈금이다. */}
              <span
                className={"effort-fill" + (currentValue === ULTRA_VALUE ? " top" : "")}
                data-effort={currentValue}
                style={{
                  width: `${choices.length > 1 ? (index / (choices.length - 1)) * 100 : 0}%`,
                }}
              />
              {choices.map((choice, i) => (
                <button
                  key={choice.value}
                  type="button"
                  className={
                    "effort-dot" +
                    (i === index ? " on" : "") +
                    (i < index ? " lit" : "") +
                    // 마지막 칸은 척도의 연장이 아니라 별개의 물건이다.
                    (choice.value === ULTRA_VALUE ? " top" : "") +
                    (choice.value === ULTRA_VALUE && !ultraReady ? " locked" : "")
                  }
                  disabled={choice.value === ULTRA_VALUE && !ultraReady}
                  aria-label={choice.name}
                  title={choice.description ?? choice.name}
                  onClick={() => onPick(choice.value)}
                />
              ))}
            </span>
          </div>
          {/* 한 줄만 보이고 넘치면 잘린다 — 전문은 title 에 남겨 둔다. */}
          <div
            className="effort-hint"
            title={currentValue === ULTRA_VALUE ? t("acp.ultracodeFull") : undefined}
          >
            {currentValue === ULTRA_VALUE ? t("acp.ultracodeHint") : t("acp.effortHint")}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 생각 줄 — 도는 동안은 "생각하는 중 · N 토큰", 끝나면 "18초 생각함".
 *
 * 토큰 수는 **추정치**다(생각 텍스트 길이 기반). 프로토콜이 생각 토큰을 따로
 * 주지 않으므로 정확한 값을 만들어 낼 수 없다 — 진행 감각을 주는 것이 목적이고,
 * 끝난 뒤에는 추정 대신 **실제로 잰 시간**을 보여 준다.
 */
function ThinkingLabel({ turn, live }: { turn: AcpTurn; live: boolean }) {
  const { t } = useT();
  const [, tick] = useState(0);

  const thinking = live && turn.thought != null && turn.thoughtEnd == null;

  // 도는 동안은 1초마다 다시 그린다 — 숫자가 멈춰 있으면 멈춘 것처럼 보인다.
  useEffect(() => {
    if (!thinking) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [thinking]);

  if (thinking) {
    return (
      <span className="think-live">
        {t("acp.thinking.live")}
        <span className="think-dots" aria-hidden="true" />
        <span className="think-meta">
          {t("acp.thinking.tokens", { n: estimateTokens(turn.thought ?? "") })}
        </span>
      </span>
    );
  }

  if (turn.thoughtStart != null && turn.thoughtEnd != null) {
    const sec = Math.max(1, Math.round((turn.thoughtEnd - turn.thoughtStart) / 1000));
    return <span>{t("acp.thinking.done", { sec })}</span>;
  }
  return <span>{t("acp.thinking")}</span>;
}

/**
 * 작업 중 상태 단어 — 한 글자씩 찍히고, 다 찍히면 잠시 머물다 다음 말로 넘어간다.
 *
 * 스피너 대신 쓰는 이유는 agentWords.ts 에 적었다: 기다림을 초조함이 아니라
 * 진행으로 읽히게 하려는 것이다.
 */
function AgentWord() {
  const { t } = useT();
  const [tickIndex, setTickIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const word = t(wordKeyAt(tickIndex));
  const total = word.length;

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(ms);
      if (ms >= wordDurationMs(total)) {
        setTickIndex((n) => n + 1);
      }
    }, 55);
    return () => window.clearInterval(timer);
  }, [total, tickIndex]);

  const typed = typedLength(elapsed, total);

  return (
    <div className="agent-word">
      {/* 타이핑되는 글자에 라이브 리전을 걸면 읽어 주는 기계가 "빚", "빚는",
          "빚는 중"을 연타로 읽는다 — 완성된 단어만 따로 한 번 알린다. */}
      <span aria-hidden="true">{word.slice(0, typed)}</span>
      <span className="agent-word-caret" aria-hidden="true" />
      <span className="trace-sr" aria-live="polite">
        {typed >= total ? word : ""}
      </span>
    </div>
  );
}
