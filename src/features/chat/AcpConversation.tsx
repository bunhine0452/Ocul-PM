import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import {
  ArrowUp,
  Paperclip,
  Square,
  SquarePen,
  TriangleAlert,
  SparklesIcon,
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

// PR-ACP2 (docs/acp-panel/00-master-plan.md §5) — ACP 대화면.
//
// 프로바이더 채팅(AiPanelScreenV2 본체)과 **상태를 공유하지 않는다.** 저쪽은
// 우리가 히스토리를 들고 매번 통째로 재전송하지만, ACP 는 세션이 에이전트 쪽에
// 살아 있어 우리는 화면에 그릴 것만 들고 있으면 된다. 두 모델을 한 상태기계에
// 욱여넣으면 양쪽 다 망가지므로 컴포넌트를 분리했다.
//
// 이 라운드가 그리는 것은 텍스트뿐이다 — 툴콜·권한 카드·플랜은 PR-ACP3/4.

interface UsageState {
  used: number;
  size: number;
  costUsd: number | null;
}

type PermissionState = Extract<AcpEvent, { kind: "permission" }>;

/** 도구 종류 → 카드에 붙일 글리프. 모르는 종류는 중립 기호로 흘린다. */
const TOOL_GLYPH: Readonly<Record<string, string>> = {
  read: "◇",
  edit: "◆",
  delete: "✕",
  move: "→",
  search: "⌕",
  execute: "▸",
  think: "◌",
  fetch: "↓",
};

/** 상태 → i18n 키. 모르는 상태는 원문 그대로 보여 준다(삼키지 않는다). */
const TOOL_STATUS_KEY = {
  pending: "acp.tool.status.pending",
  in_progress: "acp.tool.status.inProgress",
  completed: "acp.tool.status.completed",
  failed: "acp.tool.status.failed",
} as const;

/** 상태 → 색. 실패는 반드시 눈에 띄어야 한다. */
const TOOL_STATUS_COLOR: Readonly<Record<string, string>> = {
  pending: "var(--text-dim)",
  in_progress: "var(--accent)",
  completed: "var(--t-ok, var(--text-dim))",
  failed: "var(--t-bug)",
};

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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

  // `@` 를 치는 동안만 후보를 부른다 — 입력마다 디스크를 걷지 않도록 멘션이
  // 아닐 땐 즉시 닫는다.
  useEffect(() => {
    const mention = findMentionQuery(draft);
    if (!mention) {
      setMentions(null);
      return;
    }
    let cancelled = false;
    void commands.acpListFiles(projectId, mention.query, 8).then((res) => {
      if (!cancelled) setMentions(res.status === "ok" ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [draft, projectId]);

  // 스트리밍 중에는 계속 맨 아래를 따라간다.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

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

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;

    const sending = attachments;
    setDraft("");
    setAttachments([]);
    setMentions(null);
    setError(null);
    setTurns((prev) => openTurn(prev, text));
    setBusy(true);

    const channel = new Channel<AcpEvent>();
    channel.onmessage = (event) => {
      // 화면 누적은 순수 리듀서가 담당한다 (acpTurns.ts — 지각 청크 방어 포함).
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
      // 커맨드가 끝났으면 턴도 끝났다 — 이후 도착하는 청크는 받지 않는다.
      // 승인 카드도 함께 치운다: 백엔드가 미결 요청을 취소로 닫았으므로
      // 남겨 두면 눌러도 아무 일이 안 일어나는 유령 카드가 된다.
      setTurns(closeTurn);
      setPermission(null);
      setBusy(false);
    }
  }, [draft, busy, projectId, attachments]);

  const cancel = useCallback(() => {
    void commands.acpCancel(projectId);
    setPermission(null);
  }, [projectId]);

  const decide = useCallback(
    (requestId: string, optionId: string | null) => {
      setPermission(null);
      void commands.acpPermissionRespond(requestId, optionId);
    },
    [],
  );

  if (!session) {
    return (
      <div className="ai-wrap">
        <div className="ai-thread">
          <div className="ai-thread-inner">
            <div className="ai-hero">
              <div className="ai-hero-icon">
                <SparklesIcon size={22} />
              </div>
              <div className="ai-hero-title">
                {starting ? t("acp.starting") : t("acp.offTitle")}
              </div>
              <div className="ai-hero-sub">{t("acp.offSub")}</div>
              {starting ? null : (
                <button className="btn" onClick={() => void retry()}>
                  {t("acp.retry")}
                </button>
              )}
              {error && <div className="msg-error">{error}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-wrap">
      <div className="ai-thread" ref={scrollRef}>
        <div className="ai-thread-inner">
          {turns.map((turn, i) => (
            <div key={i} className={turn.role === "user" ? "msg user" : "msg assistant"}>
              <div className="msg-head">
                <span className="msg-model">
                  {turn.role === "user" ? t("acp.you") : (session.agent.title ?? session.agent.name)}
                </span>
              </div>
              {turn.thought ? (
                <details className="msg-md">
                  <summary>{t("acp.thinking")}</summary>
                  <Markdown>{turn.thought}</Markdown>
                </details>
              ) : null}
              {turn.tools?.length ? (
                <div className="msg-md" style={{ display: "grid", gap: 4 }}>
                  {turn.tools.map((tool) => (
                    <ToolCallRow key={tool.id} tool={tool} />
                  ))}
                </div>
              ) : null}
              <div className="msg-md">
                {turn.text ? (
                  <Markdown>{turn.text}</Markdown>
                ) : turn.tools?.length ? null : (
                  <span>{t("acp.waiting")}</span>
                )}
              </div>
            </div>
          ))}

          {permission ? <PermissionCard request={permission} onDecide={decide} /> : null}

          {error ? (
            <div className="msg assistant">
              <div className="msg-head">
                <TriangleAlert size={13} style={{ color: "var(--t-bug)" }} />
                <span className="msg-model" style={{ color: "var(--t-bug)" }}>
                  {t("ai.errorLabel")}
                </span>
              </div>
              <div className="msg-md">
                <div className="msg-error">{error}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="ai-compose">
        <div className="composer">
          {mentions?.length ? (
            <div className="mb-1 max-h-40 overflow-y-auto rounded border border-border bg-card">
              {mentions.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="block w-full truncate px-2 py-1 text-left text-[11px] hover:bg-muted"
                  onClick={() => pickMention(path)}
                >
                  {path}
                </button>
              ))}
            </div>
          ) : null}

          {attachments.length ? (
            <div className="mb-1 flex flex-wrap gap-1">
              {attachments.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  title={t("acp.attach.remove")}
                  onClick={() => setAttachments((prev) => prev.filter((p) => p !== path))}
                >
                  {path.split("/").pop()} ✕
                </button>
              ))}
            </div>
          ) : null}

          <textarea
            ref={inputRef}
            className="composer-input"
            rows={2}
            value={draft}
            placeholder={t("acp.placeholder")}
            aria-label={t("acp.inputAria")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-foot">
            <div className="flex flex-wrap items-center gap-2">
              {session.options.map((option) => (
                <ConfigSelect key={option.id} option={option} onChange={setOption} />
              ))}
              {usage ? (
                <span className="text-[10px] text-muted-foreground">
                  {Math.round((usage.used / Math.max(usage.size, 1)) * 100)}%
                  {usage.costUsd != null ? ` · $${usage.costUsd.toFixed(2)}` : ""}
                </span>
              ) : null}
            </div>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="btn icon ghost"
              onClick={() => void attach()}
              aria-label={t("acp.attach.add")}
              title={t("acp.attach.add")}
            >
              <Paperclip size={13} />
            </button>
            <button
              type="button"
              className="btn icon ghost"
              disabled={busy}
              onClick={() => void newConversation()}
              aria-label={t("acp.newConversation")}
              title={t("acp.newConversation")}
            >
              <SquarePen size={13} />
            </button>
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

/** 도구 호출 한 줄 — 무엇을, 어디에, 어디까지 진행됐는지. */
function ToolCallRow({ tool }: { tool: AcpToolCall }) {
  const { t } = useT();
  const glyph = TOOL_GLYPH[tool.kind] ?? "•";
  const color = TOOL_STATUS_COLOR[tool.status] ?? "var(--text-dim)";
  const statusKey = TOOL_STATUS_KEY[tool.status as keyof typeof TOOL_STATUS_KEY];

  return (
    <div className="flex items-baseline gap-2 text-[11.5px]">
      <span style={{ color }}>{glyph}</span>
      <span className="truncate">{tool.title || t("acp.tool.untitled")}</span>
      {tool.locations.length ? (
        <code className="truncate text-[10px] text-muted-foreground">
          {tool.locations.join(", ")}
        </code>
      ) : null}
      <span style={{ flex: 1 }} />
      <span className="text-[10px]" style={{ color }}>
        {statusKey ? t(statusKey) : tool.status}
      </span>
    </div>
  );
}

/**
 * 승인 카드. 응답할 때까지 에이전트가 멈춰 있으므로 **닫기 버튼을 두지 않는다** —
 * 카드를 그냥 없애면 에이전트가 영영 기다린다. 나가는 길은 선택지 또는 거절뿐.
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
  // **첫 항목**으로 왔다. 그래서 강조는 순서가 아니라 kind 로 고르고, 우리
  // 폴백 거절 버튼은 어댑터가 거절 선택지를 안 줬을 때만 낸다(중복 방지).
  const hasReject = request.options.some((option) => option.option_kind.startsWith("reject"));

  return (
    <div
      className="msg assistant"
      style={{ borderLeft: "2px solid var(--accent)" }}
      role="group"
      aria-label={t("acp.perm.title")}
    >
      <div className="msg-head">
        <span className="msg-model">{t("acp.perm.title")}</span>
      </div>
      <div className="msg-md">
        <p className="text-[12px]">
          {TOOL_GLYPH[request.tool_kind] ?? "•"} {request.title || t("acp.tool.untitled")}
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          {request.options.map((option) => (
            <button
              key={option.id}
              className={
                "btn sm " + (option.option_kind.startsWith("allow") ? "primary" : "ghost")
              }
              onClick={() => onDecide(request.request_id, option.id)}
            >
              {option.name}
            </button>
          ))}
          {/* 어댑터가 거절 선택지를 안 줄 수도 있다 — 빠져나갈 길은 항상 있어야 한다. */}
          {hasReject ? null : (
            <button className="btn sm ghost" onClick={() => onDecide(request.request_id, null)}>
              {t("acp.perm.reject")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 세션 설정 하나 (모델 · Effort · Fast mode · 권한 모드 · 서브에이전트 …).
 *
 * **선택지를 우리가 들고 있지 않는다** — 어댑터가 `session/new` 로 준 것을 그대로
 * 그린다. Claude Code 가 모델을 추가하면 우리 코드를 고치지 않아도 나타난다.
 */
function ConfigSelect({
  option,
  onChange,
}: {
  option: AcpConfigOption;
  onChange: (configId: string, value: string) => void;
}) {
  // 토글(boolean)도 값이 "true"/"false" 인 select 로 통일한다 — 항목이 늘어도
  // 렌더 분기가 하나로 유지된다.
  const choices = option.is_boolean
    ? [
        { value: "true", name: "On" },
        { value: "false", name: "Off" },
      ]
    : option.choices;

  if (!choices.length) return null;

  return (
    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span>{option.name}</span>
      <select
        className="rounded border border-border bg-transparent px-1 py-0.5 text-[10px] text-foreground"
        value={option.current ?? ""}
        onChange={(e) => onChange(option.id, e.target.value)}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.name}
          </option>
        ))}
      </select>
    </label>
  );
}
