import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  ExternalLink,
  File as FileIcon,
  Paperclip,
  Pencil,
  Search,
  Sparkles,
  Square,
  SquarePen,
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
  type AcpSession,
} from "@/lib/bindings";
import { useT } from "@/i18n";
import {
  applyAcpEvent,
  closeTurn,
  openTurn,
  type AcpToolCall,
  type AcpTurn,
} from "./acpTurns";
import { applyMention, findMentionQuery } from "./acpMention";
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

/**
 * 청크를 모았다 반영하는 간격(ms). 프로바이더 채팅과 같은 문턱을 쓴다 —
 * 더 짧으면 재파싱이 잦아 끊겨 보이고, 더 길면 타자 느낌이 사라진다.
 */
const STREAM_FLUSH_MS = 45;

/** 상태 → i18n 키. 모르는 상태는 원문 그대로 보여 준다(삼키지 않는다). */
const TOOL_STATUS_KEY = {
  pending: "acp.tool.status.pending",
  in_progress: "acp.tool.status.inProgress",
  completed: "acp.tool.status.completed",
  failed: "acp.tool.status.failed",
} as const;

export function AcpConversation({ projectId }: { projectId: number }) {
  const { t } = useT();
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /**
   * 청크 합치기 버퍼. 토큰 하나마다 setState 하면 스레드 전체가 다시 그려지고
   * 마크다운이 매번 재파싱돼 **스트리밍이 렉처럼 끊겨 보인다**. 프로바이더
   * 채팅이 이미 같은 이유로 스로틀을 쓴다 — 여기도 같은 문턱을 쓴다.
   */
  const bufferRef = useRef<{ text: string; thought: string; timer: number | null }>({
    text: "",
    thought: "",
    timer: null,
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
      if (!text || busy) return;

      const sending = attachments;
      setDraft("");
      setAttachments([]);
      setMentions(null);
      setError(null);
      setTurns((prev) => openTurn(prev, text));
      setBusy(true);

      const buffer = bufferRef.current;
      const flush = () => {
        if (buffer.timer !== null) {
          window.clearTimeout(buffer.timer);
          buffer.timer = null;
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
          if (buffer.timer === null) {
            buffer.timer = window.setTimeout(flush, STREAM_FLUSH_MS);
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
        const res = await commands.acpPrompt(projectId, text, sending, channel);
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
    [draft, busy, projectId, attachments],
  );

  const cancel = useCallback(() => {
    void commands.acpCancel(projectId);
    setPermission(null);
  }, [projectId]);

  const decide = useCallback((requestId: string, optionId: string | null) => {
    setPermission(null);
    void commands.acpPermissionRespond(requestId, optionId);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const agentName = session.agent.title ?? session.agent.name;

  return (
    <div className="ai-wrap">
      <div className="ai-thread" ref={scrollRef}>
        <div className="ai-thread-inner">
          {turns.length === 0 ? (
            <div className="ai-hero">
              <div className="ai-hero-icon">
                <Sparkles size={22} />
              </div>
              <div className="ai-hero-title">{t("acp.readyTitle", { agent: agentName })}</div>
              <div className="ai-hero-sub">{t("acp.readySub")}</div>
              <div className="ai-suggest">
                {(["acp.suggestExplain", "acp.suggestTest", "acp.suggestReview"] as const).map(
                  (key) => (
                    <button
                      key={key}
                      className="ai-suggest-chip"
                      onClick={() => void send(t(key))}
                    >
                      {t(key)}
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : (
            turns.map((turn, i) => (
              <TurnRow
                key={i}
                turn={turn}
                agentName={agentName}
                live={busy && i === turns.length - 1}
              />
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
              placeholder={t("acp.placeholder")}
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
            <button
              type="button"
              className="btn icon ghost"
              disabled={busy}
              onClick={() => void newConversation()}
              aria-label={t("acp.newConversation")}
              title={t("acp.newConversation")}
            >
              <SquarePen size={14} />
            </button>
            <span style={{ flex: 1 }} />
            {usage ? (
              <span className="agent-id-meta" title={t("acp.usageTitle")}>
                {Math.round((usage.used / Math.max(usage.size, 1)) * 100)}%
                {usage.costUsd != null ? ` · $${usage.costUsd.toFixed(2)}` : ""}
              </span>
            ) : null}
            <SettingsMenu options={session.options} onChange={setOption} busy={busy} />
            {busy ? (
              <button
                type="button"
                className="btn icon composer-stop"
                onClick={cancel}
                aria-label={t("acp.cancel")}
                title={t("acp.cancel")}
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="btn icon composer-send"
                disabled={!draft.trim()}
                onClick={() => void send()}
                aria-label={t("acp.send")}
                title={t("acp.send")}
              >
                <ArrowUp size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
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
  agentName,
  live,
}: {
  turn: AcpTurn;
  agentName: string;
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
      <div className="msg-head">
        <span className="msg-model">{agentName}</span>
        {live ? (
          <span className="msg-live">
            <span className="msg-live-dot" />
            {t("ai.streaming")}
          </span>
        ) : null}
      </div>
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
          <Markdown>{turn.text}</Markdown>
        </div>
      ) : turn.tools?.length ? null : (
        <div className="msg-wait">{t("acp.waiting")}</div>
      )}
    </div>
  );
});

/** 도구 호출 한 줄 — 무엇을, 어디에, 어디까지. 산문에 종속되어 보이게 눌러 둔다. */
function TraceRow({ tool }: { tool: AcpToolCall }) {
  const { t } = useT();
  const Icon = TOOL_ICON[tool.kind] ?? Code2;
  const statusKey = TOOL_STATUS_KEY[tool.status as keyof typeof TOOL_STATUS_KEY];
  const state =
    tool.status === "in_progress" ? " running" : tool.status === "failed" ? " failed" : "";

  return (
    <div className={"trace-row" + state}>
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
 * 세션 설정 전부를 담는 하나의 칩.
 *
 * 처음엔 항목마다 대문자 라벨을 늘어놓았는데(`MODE Manual  MODEL Sonnet …`),
 * 컴포저 바닥이 계기판처럼 시끄러워졌다. Claude Desktop 처럼 **평소엔 모델
 * 이름 하나만** 보이고, 누르면 전부 펼친다.
 *
 * **선택지는 우리가 들고 있지 않다**: 어댑터가 `session/new` 로 준 것을 그대로
 * 그리므로, 모델이 추가되면 우리 코드를 고치지 않아도 나타난다.
 */
function SettingsMenu({
  options,
  onChange,
  busy,
}: {
  options: AcpConfigOption[];
  onChange: (configId: string, value: string) => void;
  busy: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, wrapRef, useCallback(() => setOpen(false), []));

  const choicesOf = (option: AcpConfigOption) =>
    option.is_boolean
      ? [
          { value: "true", name: "On" },
          { value: "false", name: "Off" },
        ]
      : option.choices;

  // 칩에 띄울 한 줄 — 모델이 있으면 모델, 없으면 첫 항목.
  const headline = options.find((o) => o.id === "model") ?? options[0];
  const label = headline
    ? (choicesOf(headline).find((c) => c.value === headline.current)?.name ?? headline.current)
    : t("acp.settings");

  if (!options.length) return null;

  return (
    <div className="knob-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"agent-chip" + (open ? " open" : "") + (busy ? " busy" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("acp.settings")}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agent-id-dot" />
        <span className="agent-chip-label">{label}</span>
        <ChevronDown size={12} />
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
                  className={
                    "model-option" + (choice.value === option.current ? " active" : "")
                  }
                  onClick={() => {
                    setOpen(false);
                    onChange(option.id, choice.value);
                  }}
                >
                  <span className="model-option-name">{choice.name}</span>
                  <span style={{ flex: 1 }} />
                  {choice.value === option.current ? <Check size={13} /> : null}
                </button>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
