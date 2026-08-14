import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  ClipboardCheck,
  Clock,
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
import {
  commands,
  type AcpConfigOption,
  type AcpEvent,
  type AcpCommand,
  type AcpSession,
  type AcpSessionSummary,
} from "@/lib/bindings";
import { useT } from "@/i18n";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  applyAcpEvent,
  closeTurn,
  openTurn,
  type AcpToolCall,
  type AcpTurn,
} from "./acpTurns";
import { applyMention, findMentionQuery } from "./acpMention";
import { applyCommand, filterCommands, findSlashQuery } from "./acpSlash";
import { withUltracode } from "./ultracode";
import { splitMarkdownBlocks } from "./markdownBlocks";
import { relativeTime } from "./relativeTime";
import { useDismiss } from "./useDismiss";

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
  const { state } = useWorkspace();
  const panelOpen = state.acpPanelOpen;
  const [session, setSession] = useState<AcpSession | null>(null);
  const [turns, setTurns] = useState<AcpTurn[]>([]);
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
   */
  const [queue, setQueue] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /**
   * 청크 합치기 버퍼. 토큰 하나마다 setState 하면 스레드 전체가 다시 그려지고
   * 마크다운이 매번 재파싱돼 **스트리밍이 렉처럼 끊겨 보인다**. 프로바이더
   * 채팅이 이미 같은 이유로 스로틀을 쓴다 — 여기도 같은 문턱을 쓴다.
   */
  const bufferRef = useRef<{ text: string; thought: string; frame: number | null }>({
    text: "",
    thought: "",
    frame: null,
  });

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
  // 매 입력마다 걷지 않는다.
  useEffect(() => {
    const mention = findMentionQuery(draft);
    if (!mention) {
      setMentions(null);
      return;
    }
    let cancelled = false;
    void commands.acpListFiles(projectId, mention.query, 8).then((res) => {
      if (cancelled) return;
      setMentions(res.status === "ok" ? res.data : []);
      setMentionIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [draft, projectId]);

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
      setSlash(res.status === "ok" ? filterCommands(res.data, typed.query) : []);
      setSlashIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [draft, projectId]);

  // 스트리밍 중에는 계속 맨 아래를 따라간다.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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

  const refreshHistory = useCallback(async () => {
    const res = await commands.acpListSessions(projectId);
    if (res.status === "ok") setHistory(res.data);
    else setError(res.error);
  }, [projectId]);

  // 패널이 열려 있고 에이전트가 붙어 있으면 목록을 채운다. 세션이 바뀌면
  // (새 대화·재개) 목록도 다시 읽어 방금 만든 대화가 바로 보이게 한다.
  useEffect(() => {
    if (!panelOpen || !session) return;
    void refreshHistory();
  }, [panelOpen, session, refreshHistory]);

  const openSession = useCallback(
    async (sessionId: string) => {
      setTurns([]);
      setUsage(null);
      setPermission(null);
      setError(null);

      // `session/load` 는 지난 대화를 session/update 로 **되흘려보낸다**.
      // 그 이벤트를 replay 모드로 리듀서에 먹여 화면을 복원한다.
      const channel = new Channel<AcpEvent>();
      channel.onmessage = (event) => {
        setTurns((prev) => applyAcpEvent(prev, event, true));
      };

      const res = await commands.acpLoadSession(projectId, sessionId, channel);
      if (res.status === "ok") {
        setSession(res.data);
        // 재생이 끝났으니 마지막 턴을 닫는다 — 안 닫으면 다음 질문의 답이
        // 지난 답변 꼬리에 붙는다.
        setTurns(closeTurn);
      } else {
        setError(res.error);
      }
    },
    [projectId],
  );

  const pickCommand = useCallback((command: AcpCommand) => {
    setDraft(applyCommand(command));
    setSlash(null);
    inputRef.current?.focus();
  }, []);

  const newConversation = useCallback(async () => {
    const res = await commands.acpNewSession(projectId);
    if (res.status === "ok") {
      setSession(res.data);
      setTurns([]);
      setAttachments([]);
      setUsage(null);
      setPermission(null);
      setError(null);
    } else {
      setError(res.error);
    }
  }, [projectId]);

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      if (!text) return;
      if (busy) {
        setQueue((prev) => [...prev, text]);
        setDraft("");
        return;
      }

      // 최상위 effort(=Ultracode)를 고른 상태면 키워드도 함께 보낸다.
      //
      // 둘은 경쟁하는 스위치가 아니라 **같은 것의 두 경로**다: effort 값은
      // 프로토콜로, 키워드는 CLI 의 opt-in 게이트로 간다(어댑터가 우리 턴을
      // human 으로 스탬프하므로 자격이 있다). 어느 쪽이 실제로 먹는지 우리가
      // 단정할 수 없으니 둘 다 보낸다 — 키워드는 멱등이라 손해가 없다.
      const effortNow = session?.options.find((o) => o.id === "effort")?.current;
      const outgoing = withUltracode(text, effortNow === TOP_EFFORT);
      const sending = attachments;
      setDraft("");
      setAttachments([]);
      setMentions(null);
      setSlash(null);
      setError(null);
      setTurns((prev) => openTurn(prev, text));
      setBusy(true);

      const buffer = bufferRef.current;
      const flush = () => {
        if (buffer.frame !== null) {
          cancelAnimationFrame(buffer.frame);
          buffer.frame = null;
        }
        const { text, thought } = buffer;
        buffer.text = "";
        buffer.thought = "";
        if (!text && !thought) return;
        // 모아 둔 것을 **한 번의 상태 갱신**으로 반영한다.
        setTurns((prev) => {
          let next = prev;
          if (text) next = applyAcpEvent(next, { kind: "chunk", text });
          if (thought) next = applyAcpEvent(next, { kind: "thought", text: thought });
          return next;
        });
      };

      const channel = new Channel<AcpEvent>();
      channel.onmessage = (event) => {
        if (event.kind === "chunk" || event.kind === "thought") {
          if (event.kind === "chunk") buffer.text += event.text;
          else buffer.thought += event.text;
          // **프레임에 맞춰** 한 번만 반영한다. 타이머(45ms)는 화면 갱신과
          // 어긋나 글자가 뭉텅이로 튀어 보였다 — rAF 는 브라우저가 그리는
          // 리듬과 같아서 같은 양의 글자라도 흐르듯 나온다.
          if (buffer.frame === null) {
            buffer.frame = requestAnimationFrame(flush);
          }
          return;
        }

        // 텍스트가 아닌 사건(툴콜·승인·종료)은 순서가 중요하다 — 모아 둔
        // 글자를 먼저 내보내고 나서 적용해야 카드가 문장 앞으로 튀지 않는다.
        flush();
        setTurns((prev) => applyAcpEvent(prev, event));
        if (event.kind === "usage") {
          setUsage({ used: event.used, size: event.size, costUsd: event.cost_usd });
        } else if (event.kind === "failed") {
          setError(event.message);
        } else if (event.kind === "permission") {
          setPermission(event);
        }
      };

      try {
        const res = await commands.acpPrompt(projectId, outgoing, sending, channel);
        if (res.status === "error") setError(res.error);
      } finally {
        flush();
        // 커맨드가 끝났으면 턴도 끝났다 — 이후 도착하는 청크는 받지 않는다.
        // 승인 카드도 함께 치운다: 백엔드가 미결 요청을 취소로 닫았으므로
        // 남겨 두면 눌러도 아무 일이 안 일어나는 유령 카드가 된다.
        setTurns(closeTurn);
        setPermission(null);
        setBusy(false);
      }
    },
    [draft, busy, projectId, attachments, session],
  );

  // 턴이 끝나면 큐의 맨 앞을 꺼내 보낸다. **한 번에 하나씩** — 한꺼번에 밀어
  // 넣으면 사용자가 중간에서 멈출 수 없다.
  //
  // `drainingRef` 가 필요한 이유: 이 effect 는 `send` 의 아이덴티티(=입력할
  // 때마다 바뀐다)에도 걸려 있고 StrictMode 는 effect 를 두 번 돌린다. 가드가
  // 없으면 같은 문장이 두 번 나갈 수 있다.
  const drainingRef = useRef(false);
  useEffect(() => {
    if (busy || !queue.length || drainingRef.current) return;
    drainingRef.current = true;
    const [next, ...rest] = queue;
    setQueue(rest);
    void send(next).finally(() => {
      drainingRef.current = false;
    });
  }, [busy, queue, send]);

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
      e.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [busy, cancel]);

  const decide = useCallback((requestId: string, optionId: string | null) => {
    setPermission(null);
    void commands.acpPermissionRespond(requestId, optionId);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  if (!session) {
    return (
      <div className="ai-wrap">
        <div className="ai-thread">
          <div className="ai-thread-inner">
            <div className="ai-hero">
              <div className="ai-hero-icon">
                <Sparkles size={22} />
              </div>
              <div className="ai-hero-title">
                {starting ? t("acp.starting") : t("acp.offTitle")}
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
    );
  }

  return (
    <div className="acp-layout">
      <div className="ai-wrap">
      <div className="ai-thread" ref={scrollRef}>
        <div className="ai-thread-inner">
          {turns.length === 0 ? (
            /* 시작 화면은 조용해야 한다 — 칩을 늘어놓으면 "무엇을 시킬까"를
               고르는 화면이 되고, 정작 하려던 말을 밀어낸다. 마크 하나와 두
               줄이면 충분하다 (Claude Code 시작 화면 벤치마크). */
            <div className="ai-hero acp-hero">
              <div className="ai-hero-icon">
                <Sparkles size={22} />
              </div>
              <div className="ai-hero-title">{t("acp.readyTitle")}</div>
              <div className="ai-hero-sub">{t("acp.readySub")}</div>
            </div>
          ) : (
            turns.map((turn, i) => (
              <TurnRow key={i} turn={turn} live={busy && i === turns.length - 1} />
            ))
          )}

          {permission ? <PermissionCard request={permission} onDecide={decide} /> : null}

          {error ? (
            <div className="msg assistant">
              <div className="msg-head">
                <TriangleAlert size={13} style={{ color: "var(--t-bug)" }} />
                <span className="msg-model" style={{ color: "var(--t-bug)" }}>
                  {t("ai.errorLabel")}
                </span>
              </div>
              <div className="msg-error">{error}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="ai-compose agent">
        <div className="composer agent">
          {queue.length ? (
            <div className="queue-row">
              {queue.map((text, i) => (
                <button
                  key={i}
                  type="button"
                  className="queue-chip"
                  title={t("acp.queue.remove")}
                  onClick={() => setQueue((prev) => prev.filter((_, at) => at !== i))}
                >
                  <Clock size={11} />
                  <span className="queue-chip-text">{text}</span>
                  <X size={11} />
                </button>
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
              rows={2}
              value={draft}
              placeholder={busy ? t("acp.placeholderBusy") : t("acp.placeholder")}
              aria-label={t("acp.inputAria")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
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
            {/* 사용량 표시가 곧 버튼이다 — 숫자를 보다가 "자세히"를 누르고
                싶어지는 자리가 바로 여기다. */}
            <button
              type="button"
              className="usage-btn"
              disabled={busy}
              onClick={() => void send("/usage")}
              title={t("acp.usageTitle")}
            >
              {usage ? (
                <>
                  {Math.round((usage.used / Math.max(usage.size, 1)) * 100)}%
                  {usage.costUsd != null ? ` · $${usage.costUsd.toFixed(2)}` : ""}
                </>
              ) : (
                t("acp.usage")
              )}
            </button>
            {PRIMARY_CONFIG_IDS.map((id) => {
              const option = session.options.find((o) => o.id === id);
              if (!option) return null;
              // Effort 만 슬라이더다 — 값에 **순서**가 있기 때문. 순서 있는
              // 값을 목록으로 고르게 하면 "지금이 어느 정도인지"가 안 보인다.
              return id === "effort" ? (
                <EffortControl key={id} option={option} onChange={setOption} />
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
        sessions={history ?? []}
        currentId={session.session_id}
        query={historyQuery}
        onQuery={setHistoryQuery}
        onPick={(id) => void openSession(id)}
        onNew={() => void newConversation()}
        busy={busy}
      />

    </div>
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
const TurnRow = memo(function TurnRow({
  turn,
  live,
}: {
  turn: AcpTurn;
  live: boolean;
}) {
  const { t } = useT();

  if (turn.role === "user") {
    return (
      <div className="msg user">
        <div className="msg-bubble">{turn.text}</div>
      </div>
    );
  }

  return (
    <div className={"msg assistant" + (live ? " streaming" : "")}>
      {/* 이름을 적지 않는다 — 답이 하나뿐인 화면에서 매 턴 "Claude Agent" 를
          반복하면 정보가 아니라 소음이다. 진행 중임은 점 하나로 족하다. */}
      {live ? (
        <div className="msg-head">
          <span className="msg-live-dot" />
        </div>
      ) : null}
      {turn.thought ? (
        <details className="think">
          <summary>
            <ChevronDown size={12} /> {t("acp.thinking")}
          </summary>
          <div className="think-body msg-md">
            <Markdown>{turn.thought}</Markdown>
          </div>
        </details>
      ) : null}
      {turn.tools?.length ? (
        <div className="trace">
          {turn.tools.map((tool) => (
            <TraceRow key={tool.id} tool={tool} />
          ))}
        </div>
      ) : null}
      {turn.text ? (
        <div className="msg-md">
          {/* 스트리밍 중에도 **서식이 바로 보인다.** 평문으로 뒀다 끝에
              포맷하면 점프가 생기고, 매 프레임 전체를 파싱하면 끊긴다 —
              둘 다 겪었다. 블록으로 쪼개면 완성된 블록은 문자열이 안 바뀌어
              memo 가 재파싱을 건너뛰고, 매번 다시 파싱되는 건 마지막 블록
              하나뿐이라 비용이 문단 길이에 묶인다. */}
          {live ? <StreamingMarkdown text={turn.text} /> : <Markdown>{turn.text}</Markdown>}
        </div>
      ) : turn.tools?.length ? null : (
        <div className="msg-wait">{t("acp.waiting")}</div>
      )}
    </div>
  );
});

/**
 * 도구 호출 한 줄 — 무엇을, 어디에, 어디까지. 산문에 종속되어 보이게 눌러 둔다.
 *
 * 눌러서 펼치면 들어간 것(IN)과 나온 것(OUT)이 보인다. **기본은 접힘**이다:
 * 도구 출력은 수백 줄이 예사라 다 펼쳐 두면 정작 읽어야 할 답변이 아래로
 * 밀려난다.
 */
function TraceRow({ tool }: { tool: AcpToolCall }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[tool.kind] ?? Code2;
  const statusKey = TOOL_STATUS_KEY[tool.status as keyof typeof TOOL_STATUS_KEY];
  const state =
    tool.status === "in_progress" ? " running" : tool.status === "failed" ? " failed" : "";
  const expandable = Boolean(tool.input || tool.output);

  return (
    <div className={"trace-item" + (open ? " open" : "")}>
      <button
        type="button"
        className={"trace-row" + state}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="trace-icon">
          <Icon size={13} />
        </span>
        <span className="trace-title">{tool.title || t("acp.tool.untitled")}</span>
        {tool.locations.length ? (
          <span className="trace-path" title={tool.locations.join("\n")}>
            {tool.locations[0]}
          </span>
        ) : null}
        {tool.locations.length > 1 ? (
          <span className="trace-more">+{tool.locations.length - 1}</span>
        ) : null}
        <span className="trace-status">{statusKey ? t(statusKey) : tool.status}</span>
        {expandable ? (
          <ChevronDown size={12} className="trace-caret" />
        ) : null}
      </button>
      {open ? (
        <div className="trace-body">
          {tool.input ? (
            <div className="trace-io">
              <span className="trace-io-tag">IN</span>
              <pre>{tool.input}</pre>
            </div>
          ) : null}
          {tool.output ? (
            <div className="trace-io">
              <span className="trace-io-tag">OUT</span>
              <pre>{tool.output}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
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

  return (
    <div className="perm" role="group" aria-label={t("acp.perm.title")}>
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
      <div className="perm-actions">
        {request.options.map((option) => (
          <button
            key={option.id}
            className={"btn sm " + (option.option_kind.startsWith("allow") ? "primary" : "ghost")}
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
 * 최상위 effort 값. 사용자 쪽 Claude Code 는 이 자리를 **"Ultracode"** 라
 * 부르고 "xhigh + workflows" 로 설명한다 — 어댑터는 `max` 라는 이름만 주므로
 * 라벨을 우리가 맞춘다.
 */
const TOP_EFFORT = "max";

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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  const choices = choicesOf(option);
  if (!choices.length) return null;

  const current = choices.find((c) => c.value === option.current);
  const TriggerIcon = CONFIG_ICON[option.id];

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"agent-chip" + (open ? " open" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={option.name}
        onClick={() => setOpen((v) => !v)}
      >
        {TriggerIcon ? <TriggerIcon size={13} /> : null}
        {compact ? null : (
          <span className="agent-chip-label">{current?.name ?? option.current}</span>
        )}
      </button>
      {open ? (
        <div className="settings-menu" role="menu" aria-label={option.name}>
          <div className="settings-group-label">{option.name}</div>
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
                <span className="settings-row-icon">
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
function SessionPanel({
  open,
  sessions,
  currentId,
  query,
  onQuery,
  onPick,
  onNew,
  busy,
}: {
  open: boolean;
  sessions: AcpSessionSummary[];
  currentId: string | null;
  query: string;
  onQuery: (next: string) => void;
  onPick: (id: string) => void;
  onNew: () => void;
  busy: boolean;
}) {
  const { t } = useT();
  // 목록 전체가 **같은 기준 시각**을 써야 렌더 도중 분이 넘어가며 순서가
  // 흔들리지 않는다.
  const now = useMemo(() => Date.now(), [sessions]);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? sessions.filter((s) => (s.title ?? "").toLowerCase().includes(needle))
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

      <button type="button" className="acp-panel-new" disabled={busy} onClick={onNew}>
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
      </div>

      <div className="acp-panel-list">
        {shown.length ? (
          shown.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"acp-session" + (item.id === currentId ? " active" : "")}
              onClick={() => onPick(item.id)}
              title={item.title ?? undefined}
            >
              <span className="acp-session-title">
                {item.title || t("acp.untitledSession")}
              </span>
              <span className="acp-session-time">{relativeTime(item.updated_at, now)}</span>
            </button>
          ))
        ) : (
          <div className="acp-panel-empty">
            {sessions.length ? t("acp.history.noMatch") : t("acp.history.empty")}
          </div>
        )}
      </div>
      </div>
    </aside>
  );
}

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
}: {
  option: AcpConfigOption;
  onChange: (configId: string, value: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  const choices = useMemo(
    () =>
      option.choices
        .filter((c) => c.value !== "default")
        // 최상위는 어댑터가 "Max" 라 부르지만 사용자가 아는 이름은 Ultracode 다.
        .map((c) => (c.value === TOP_EFFORT ? { ...c, name: t("acp.ultracode") } : c)),
    [option.choices, t],
  );
  if (!choices.length) return null;

  // 현재 값이 `default` 로 와도 사용자에게는 실제 동작인 xhigh 로 보인다.
  const currentValue = option.current === "default" ? "xhigh" : option.current;
  const index = Math.max(
    0,
    choices.findIndex((c) => c.value === currentValue),
  );
  const current = choices[index];

  const move = (delta: number) => {
    const next = Math.min(choices.length - 1, Math.max(0, index + delta));
    if (next !== index) onChange(option.id, choices[next].value);
  };

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"agent-chip" + (open ? " open" : "")}
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
            role="slider"
            tabIndex={0}
            aria-label={option.name}
            aria-valuemin={0}
            aria-valuemax={choices.length - 1}
            aria-valuenow={index}
            aria-valuetext={current?.name}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                e.preventDefault();
                move(-1);
              }
            }}
          >
            <span className="effort-track">
              {choices.map((choice, i) => (
                <button
                  key={choice.value}
                  type="button"
                  className={
                    "effort-dot" +
                    (i === index ? " on" : "") +
                    (i < index ? " lit" : "") +
                    // 마지막 단계는 척도의 연장이 아니라 별개의 물건이다.
                    (i === choices.length - 1 ? " top" : "")
                  }
                  aria-label={choice.name}
                  title={choice.description ?? choice.name}
                  onClick={() => onChange(option.id, choice.value)}
                />
              ))}
            </span>
            <span
              className={"effort-label" + (currentValue === TOP_EFFORT ? " top" : "")}
            >
              {current?.name ?? currentValue}
            </span>
          </div>
          <div className="effort-hint">
            {currentValue === TOP_EFFORT ? t("acp.ultracodeHint") : t("acp.effortHint")}
          </div>
        </div>
      ) : null}
    </div>
  );
}
