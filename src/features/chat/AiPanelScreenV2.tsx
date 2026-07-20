import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Toolbar } from "@/components/Toolbar";
import {
  SparklesIcon,
  Paperclip,
  ArrowUp,
  ArrowDown,
  History,
  TriangleAlert,
  ChevronDown,
  Check,
  Copy,
  Square,
  SquarePen,
} from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import {
  commands,
  type ChatEvent,
  type ChatOptions,
  type Message,
  type Role,
} from "@/lib/bindings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { PROVIDERS, providerModel, parseFallbacks, type Provider } from "@/lib/settings";
import {
  estimateTokens,
  estimateMessagesTokens,
  formatTokenCount,
  MESSAGE_OVERHEAD_TOKENS,
} from "@/lib/tokenEstimate";
import { assembleAiContext, type AiContextResult } from "./aiContext";
import { ActionProposalCard, extractPlannerAction } from "./aiActions";
import { ConversationHistoryModal } from "./ConversationHistoryModal";

// AI 패널 (ui_v2) — 2026-07-20 대규모 개편.
//  - 모델 선택: 상단 칩 바 → Cursor 식 컴포저 하단 드롭다운(위로 열림).
//  - 스트리밍 중에도 마크다운 라이브 렌더 (~45ms 스로틀 + 행 단위 memo).
//  - 전송 전 입력 토큰 추정 배지(+파트별 브레이크다운 팝오버): 컨텍스트
//    토글·질문·대화 기록 변화에 디바운스로 재계산, 전송 시 캐시 재사용.
//  - 답변 중지(클라이언트측 — 표시분까지만 확정·저장), 메시지 복사,
//    스마트 오토스크롤(+맨아래 FAB), 빈 상태 제안 프롬프트.
// 대화 기억: 스레드 전체 메시지를 SQLite 에 영속하고 매 전송마다 전부
// 리플레이한다(요약·절단 없음). 컨텍스트(system)는 저장하지 않고 매 전송마다
// 최신 상태로 1부 재조립해 주입한다.

const VENDOR: Record<Provider, { name: string; vendor: string; color: string }> = {
  anthropic: { name: "Claude", vendor: "Anthropic", color: "#d97a4f" },
  openai: { name: "GPT", vendor: "OpenAI", color: "#1aa37a" },
  gemini: { name: "Gemini", vendor: "Google", color: "#4a7ad9" },
  nim: { name: "NIM", vendor: "NVIDIA", color: "#76b900" },
  openrouter: { name: "OpenRouter", vendor: "OpenRouter", color: "#6566f1" },
};

// Display message — tracks the provider that produced each assistant turn so
// switching the active model doesn't re-skin past answers (dogfood 발견 2).
type ChatMsg = { role: Role; content: string; provider?: Provider };

type EstimateRow = { label: string; tokens: number };
type Estimate = { total: number; rows: EstimateRow[]; ragPending: boolean };

function secretName(p: Provider): string {
  return `${p}_api_key`;
}

const SUGGESTIONS = [
  "이 프로젝트 구조를 한눈에 요약해줘",
  "최근 작업일지를 바탕으로 다음 할 일을 제안해줘",
  "플래너 진행 상황을 정리하고 리스크를 짚어줘",
  "최근 커밋 흐름을 리뷰해줘",
];

/** open 상태의 팝업을 바깥 클릭/Escape 로 닫는 공통 훅. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

/** 어시스턴트 말풍선 하나 — 스트리밍 중이 아닌 행은 memo 로 재파싱을 막는다. */
const MessageRow = memo(function MessageRow({
  msg,
  isStreamingRow,
  fallbackProvider,
  conversationId,
  messageIndex,
  projectId,
}: {
  msg: ChatMsg;
  isStreamingRow: boolean;
  fallbackProvider: Provider;
  conversationId: number | null;
  messageIndex: number;
  projectId: number;
}) {
  const [copied, setCopied] = useState(false);
  const mp = msg.provider ?? fallbackProvider;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }, [msg.content]);

  if (msg.role === "user") {
    return (
      <div className="msg user">
        <div className="msg-bubble">{msg.content}</div>
      </div>
    );
  }

  return (
    <div className={"msg assistant" + (isStreamingRow ? " streaming" : "")}>
      <div className="msg-head">
        <span className="model-dot" style={{ background: VENDOR[mp].color }} />
        <span className="msg-model">{VENDOR[mp].name}</span>
        <span className="msg-vendor">{VENDOR[mp].vendor}</span>
        {isStreamingRow ? (
          <span className="msg-live">
            <span className="msg-live-dot" /> 생성 중
          </span>
        ) : msg.content ? (
          <button
            type="button"
            className="msg-copy"
            onClick={() => void copy()}
            aria-label="답변 복사"
            title="답변 복사"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        ) : null}
      </div>
      <div className="msg-md">
        {isStreamingRow ? (
          msg.content ? (
            <Markdown>{msg.content}</Markdown>
          ) : (
            <div className="msg-wait">응답 대기 중…</div>
          )
        ) : msg.content ? (
          (() => {
            const { cleanText, action } = extractPlannerAction(msg.content);
            return (
              <>
                {cleanText ? <Markdown>{cleanText}</Markdown> : null}
                {action ? (
                  <ActionProposalCard
                    action={action}
                    conversationId={conversationId}
                    messageIndex={messageIndex}
                    projectId={projectId}
                    onApplied={() => {}}
                  />
                ) : null}
              </>
            );
          })()
        ) : null}
      </div>
    </div>
  );
});

interface AiPanelScreenV2Props {
  projectId: number;
}

export function AiPanelScreenV2({ projectId }: AiPanelScreenV2Props) {
  const { state, setState, setUiV2View } = useWorkspace();
  const { settings } = useSettings();

  const initialProvider = (state.aiActiveModel as Provider | null) ?? settings.defaultProvider;
  const [provider, setProvider] = useState<Provider>(
    PROVIDERS.includes(initialProvider) ? initialProvider : "anthropic",
  );
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [tokenPopOpen, setTokenPopOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  // Keyring presence per provider (null = checking). Models without a key are
  // disabled (dogfood 발견 4).
  const [hasKey, setHasKey] = useState<Record<Provider, boolean | null>>({
    anthropic: null,
    openai: null,
    gemini: null,
    nim: null,
    openrouter: null,
  });
  // Which project context to attach to each question. Defaults: 코드(RAG) +
  // 일지 + 플래너 on, git off.
  const [ctx, setCtx] = useState({
    rag: true,
    oculpm: settings.includeOculpmContext,
    planner: true,
    git: false,
  });
  // What actually got attached to the most recent send (token 팝오버에 표시).
  const [lastAttached, setLastAttached] = useState<string[]>([]);
  // 전송 전 입력 토큰 추정 (디바운스 재계산).
  const [estimate, setEstimate] = useState<Estimate | null>(null);

  const threadRef = useRef<number | null>(
    state.aiThreadId != null ? Number(state.aiThreadId) : null,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const tokenPopRef = useRef<HTMLDivElement | null>(null);
  // 마지막 추정에 쓴 조립 결과 — 같은 (질문, 토글, 기록) 이면 전송 때 재사용해
  // 컨텍스트 이중 조립을 피한다.
  const estCacheRef = useRef<{ key: string; ctx: AiContextResult } | null>(null);
  // 진행 중 스트림 중지 콜백 (없으면 null).
  const abortRef = useRef<(() => void) | null>(null);

  // Resolve or create the shared conversation thread on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listRes = await commands.conversationList(projectId);
      if (cancelled) return;
      const convs = listRes.status === "ok" ? listRes.data : [];
      let id = threadRef.current;
      if (id == null || !convs.some((c) => c.id === id)) {
        id = convs[0]?.id ?? null;
      }
      if (id == null) {
        const created = await commands.conversationCreate("AI 패널", provider, null, projectId);
        if (cancelled) return;
        if (created.status === "ok") id = created.data.id;
      }
      if (id != null) {
        threadRef.current = id;
        setState((prev) => ({ ...prev, aiThreadId: String(id) }));
        const msgs = await commands.chatMessageList(id);
        if (cancelled) return;
        if (msgs.status === "ok") {
          setMessages(
            msgs.data.map((m) => ({
              role: m.role as Role,
              content: m.content,
              provider: (m.provider as Provider | null) ?? undefined,
            })),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Persist the active provider as aiActiveModel.
  useEffect(() => {
    setState((prev) =>
      prev.aiActiveModel === provider ? prev : { ...prev, aiActiveModel: provider },
    );
  }, [provider, setState]);

  // Keyring presence per provider (cached check — does NOT unlock the keychain).
  useEffect(() => {
    let cancelled = false;
    PROVIDERS.forEach(async (p) => {
      const res = await commands.secretHas(secretName(p));
      if (!cancelled && res.status === "ok") {
        setHasKey((prev) => ({ ...prev, [p]: res.data }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // If the active provider has no key, fall back to the first one that does.
  useEffect(() => {
    if (hasKey[provider] === false) {
      const firstWithKey = PROVIDERS.find((p) => hasKey[p] === true);
      if (firstWithKey) setProvider(firstWithKey);
    }
  }, [hasKey, provider]);

  const anyKey = PROVIDERS.some((p) => hasKey[p] === true);
  const keysResolved = PROVIDERS.every((p) => hasKey[p] !== null);

  useDismiss(modelMenuOpen, modelMenuRef, () => setModelMenuOpen(false));
  useDismiss(tokenPopOpen, tokenPopRef, () => setTokenPopOpen(false));

  // ── 스크롤: 바닥 근처일 때만 오토스크롤, 아니면 FAB 노출 ────────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    atBottomRef.current = nearBottom;
    setAtBottom(nearBottom);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // 입력창 자동 높이 (최대 180px).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [draft]);

  // Typewriter animation handle — cancel on unmount so a mid-stream nav-away
  // doesn't setState on an unmounted component.
  const rafRef = useRef(0);
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const ctxKeyOf = useCallback(
    (query: string) =>
      JSON.stringify({
        q: query,
        r: ctx.rag,
        o: ctx.oculpm,
        p: ctx.planner,
        g: ctx.git,
        id: projectId,
        n: messages.length,
      }),
    [ctx, projectId, messages.length],
  );

  // ── 입력 토큰 추정 — 토글/질문/기록이 바뀌면 500ms 디바운스로 재계산 ────
  useEffect(() => {
    if (streaming) return; // 스트리밍 중엔 매 틱 재계산 방지
    let cancelled = false;
    const query = draft.trim();
    const key = ctxKeyOf(query);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const aiCtx = await assembleAiContext({
            projectId,
            query,
            settings,
            includeRag: ctx.rag,
            includeOculpm: ctx.oculpm,
            includePlanner: ctx.planner,
            includeGit: ctx.git,
          });
          if (cancelled) return;
          estCacheRef.current = { key, ctx: aiCtx };
          const rows: EstimateRow[] = aiCtx.parts
            .map((p) => ({ label: p.label, tokens: estimateTokens(p.text) }))
            .filter((r) => r.tokens > 0);
          const hist = estimateMessagesTokens(messages);
          if (hist > 0) rows.push({ label: `대화 기록 ${messages.length}개`, tokens: hist });
          if (query) rows.push({ label: "질문", tokens: MESSAGE_OVERHEAD_TOKENS + estimateTokens(query) });
          setEstimate({
            total: rows.reduce((s, r) => s + r.tokens, 0),
            rows,
            ragPending: ctx.rag && !query,
          });
        } catch {
          /* best-effort — 추정 실패는 무시 */
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ctx, draft, messages, projectId, settings, streaming, ctxKeyOf]);

  const send = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || streaming) return;
    if (hasKey[provider] === false) {
      setError(`${VENDOR[provider].name} 의 API 키가 없습니다. 설정에서 추가하세요.`);
      return;
    }
    setError(null);

    const model = providerModel(settings, provider);
    const baseHistory = messages;
    const userMessage: ChatMsg = { role: "user" as Role, content: trimmed };
    setMessages([
      ...baseHistory,
      userMessage,
      { role: "assistant" as Role, content: "", provider },
    ]);
    setDraft("");
    setStreaming(true);
    atBottomRef.current = true;

    // chatStream wants plain {role, content} — strip the display-only provider.
    const llmHistory: Message[] = [...baseHistory, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));
    // 프로젝트 컨텍스트 주입 — 직전 추정에 쓴 조립 결과와 (질문·토글·기록) 이
    // 같으면 재사용, 아니면 새로 조립. Best-effort: a failing source is omitted.
    const cached = estCacheRef.current;
    const key = ctxKeyOf(trimmed);
    const aiCtx =
      cached && cached.key === key
        ? cached.ctx
        : await assembleAiContext({
            projectId,
            query: trimmed,
            settings,
            includeRag: ctx.rag,
            includeOculpm: ctx.oculpm,
            includePlanner: ctx.planner,
            includeGit: ctx.git,
          });
    setLastAttached(aiCtx.attached);
    if (aiCtx.system) {
      llmHistory.unshift({ role: "system" as Role, content: aiCtx.system });
    }
    const chatOptions: ChatOptions = {
      model,
      temperature: settings.temperature ?? null,
      max_tokens: settings.maxTokens ?? null,
    };

    // Typewriter: deltas fill `target`; a rAF loop reveals characters with a
    // ~45ms throttle — 마크다운 라이브 렌더의 재파싱 비용을 22fps 로 캡.
    let target = "";
    let shown = 0;
    let receiving = true;
    let aborted = false;
    let lastReveal = 0;

    const renderShown = () => {
      const text = target.slice(0, shown);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant" as Role, content: text, provider };
        return next;
      });
    };

    let persisted = false;
    const persist = (assistantText: string) => {
      const id = threadRef.current;
      if (id == null || persisted) return;
      persisted = true;
      void commands.chatMessageAppend(id, "user", trimmed, provider, model);
      if (assistantText) {
        void commands.chatMessageAppend(id, "assistant", assistantText, provider, model);
      }
    };

    const finishReveal = () => {
      rafRef.current = 0;
      setStreaming(false);
      abortRef.current = null;
    };

    const tick = (now: number) => {
      if (aborted) return;
      if (shown < target.length) {
        if (now - lastReveal >= 45) {
          lastReveal = now;
          // Reveal a chunk scaled to the backlog — fast catch-up on big dumps,
          // smooth on the tail.
          shown = Math.min(target.length, shown + Math.max(8, Math.ceil((target.length - shown) / 4)));
          renderShown();
        }
        rafRef.current = requestAnimationFrame(tick);
      } else if (receiving) {
        rafRef.current = requestAnimationFrame(tick); // caught up — await more deltas
      } else {
        finishReveal(); // fully revealed + stream closed
      }
    };

    // 중지: 수신 중이면 지금까지 표시된 분량으로 잘라 확정·저장하고 이후
    // 델타는 무시한다 (백엔드 스트림 취소 커맨드는 없음). 수신은 끝났고
    // 타자 애니메이션만 남은 상태면 남은 텍스트를 즉시 전부 표시한다.
    abortRef.current = () => {
      if (aborted) return;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (receiving) {
        aborted = true;
        receiving = false;
        target = target.slice(0, shown);
        if (target) renderShown();
        else setMessages((prev) => prev.slice(0, -1)); // 델타 0 — 빈 스텁 제거
        setStreaming(false);
        abortRef.current = null;
        persist(target);
      } else {
        shown = target.length;
        renderShown();
        finishReveal();
      }
    };

    const channel = new Channel<ChatEvent>();
    channel.onmessage = (event) => {
      if (aborted) return;
      if (event.kind === "delta") {
        target += event.text;
        if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
      } else if (event.kind === "error") {
        setError(event.message);
      }
    };

    let res;
    try {
      res = await commands.chatStream(provider, llmHistory, chatOptions, parseFallbacks(settings), channel);
    } catch (err) {
      if (aborted) return;
      receiving = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      setError(String(err));
      setStreaming(false);
      abortRef.current = null;
      setMessages((prev) => prev.slice(0, -1));
      return;
    }
    if (aborted) return;
    receiving = false; // backend done sending — let the typewriter drain the rest
    if (res.status === "error") {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      setError(res.error);
      setMessages((prev) => prev.slice(0, -1));
      setStreaming(false);
      abortRef.current = null;
      return;
    }
    if (!rafRef.current) {
      // No deltas arrived (or already drained) — finalize immediately.
      shown = target.length;
      renderShown();
      finishReveal();
    }
    // else: the running tick loop reveals the remainder and clears `streaming`.

    // Persist the FULL text (not the partially-revealed display).
    if (target) persist(target);
  }, [draft, streaming, messages, provider, settings, hasKey, ctx, projectId, ctxKeyOf]);

  const stop = useCallback(() => {
    abortRef.current?.();
  }, []);

  // ── 대화 기록 (A3) — switch / new / reconcile-after-delete ──────────────
  const loadThread = useCallback(
    async (id: number) => {
      threadRef.current = id;
      setState((prev) => ({ ...prev, aiThreadId: String(id) }));
      setError(null);
      const msgs = await commands.chatMessageList(id);
      setMessages(
        msgs.status === "ok"
          ? msgs.data.map((m) => ({
              role: m.role as Role,
              content: m.content,
              provider: (m.provider as Provider | null) ?? undefined,
            }))
          : [],
      );
    },
    [setState],
  );

  const handleSelectThread = useCallback(
    async (id: number) => {
      await loadThread(id);
      setHistoryOpen(false);
    },
    [loadThread],
  );

  const handleNewThread = useCallback(async () => {
    const res = await commands.conversationCreate("새 대화", provider, null, projectId);
    if (res.status === "ok") await loadThread(res.data.id);
    setHistoryOpen(false);
  }, [provider, projectId, loadThread]);

  // The active conversation was deleted — fall back to the most recent or a new one.
  const handleActiveDeleted = useCallback(async () => {
    const listRes = await commands.conversationList(projectId);
    const convs = listRes.status === "ok" ? listRes.data : [];
    let id = convs[0]?.id ?? null;
    if (id == null) {
      const created = await commands.conversationCreate("AI 패널", provider, null, projectId);
      if (created.status === "ok") id = created.data.id;
    }
    if (id != null) await loadThread(id);
    else {
      threadRef.current = null;
      setMessages([]);
    }
  }, [projectId, provider, loadThread]);

  const activeModel = providerModel(settings, provider);

  return (
    <>
      <Toolbar title="AI 패널" sub="여러 LLM에 같은 컨텍스트로 질문">
        <button className="btn" onClick={() => void handleNewThread()} title="새 대화 시작">
          <SquarePen size={15} /> 새 대화
        </button>
        <button className="btn" onClick={() => setHistoryOpen(true)} title="대화 기록">
          <History size={15} /> 대화 기록
        </button>
      </Toolbar>

      <div className="ai-wrap">
        <div className="ai-thread" ref={scrollRef} onScroll={handleScroll}>
          <div className="ai-thread-inner">
            {messages.length === 0 ? (
              keysResolved && !anyKey ? (
                <div className="ai-hero">
                  <div className="ai-hero-icon">
                    <SparklesIcon size={22} />
                  </div>
                  <div className="ai-hero-title">사용할 수 있는 API 키가 없어요</div>
                  <div className="ai-hero-sub">
                    <button
                      type="button"
                      className="set-link"
                      onClick={() => setUiV2View("settings")}
                    >
                      설정에서 키 추가 →
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ai-hero">
                  <div className="ai-hero-icon">
                    <SparklesIcon size={22} />
                  </div>
                  <div className="ai-hero-title">무엇이든 물어보세요</div>
                  <div className="ai-hero-sub">
                    코드 · 작업일지 · 플래너 · git 컨텍스트를 붙여 질문할 수 있어요.
                  </div>
                  <div className="ai-suggest">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="ai-suggest-chip"
                        onClick={() => {
                          setDraft(s);
                          taRef.current?.focus();
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )
            ) : (
              messages.map((m, i) => (
                <MessageRow
                  key={i}
                  msg={m}
                  isStreamingRow={streaming && i === messages.length - 1 && m.role === "assistant"}
                  fallbackProvider={provider}
                  conversationId={threadRef.current}
                  messageIndex={i}
                  projectId={projectId}
                />
              ))
            )}
            {error ? (
              <div className="msg assistant">
                <div className="msg-head">
                  <TriangleAlert size={13} style={{ color: "var(--t-bug)" }} />
                  <span className="msg-model" style={{ color: "var(--t-bug)" }}>오류</span>
                </div>
                <div className="msg-md">
                  <div className="msg-error">{error}</div>
                </div>
              </div>
            ) : null}
          </div>
          {!atBottom ? (
            <button
              type="button"
              className="ai-scroll-fab"
              onClick={scrollToBottom}
              aria-label="맨 아래로"
              title="맨 아래로"
            >
              <ArrowDown size={15} />
            </button>
          ) : null}
        </div>

        <div className="ai-compose">
          <div className="composer">
            <div className="composer-ctx">
              <Paperclip size={13} />
              {(
                [
                  { key: "rag", label: "코드" },
                  { key: "oculpm", label: "작업일지" },
                  { key: "planner", label: "플래너" },
                  { key: "git", label: "git" },
                ] as const
              ).map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className={"scope-chip" + (ctx[it.key] ? " on" : "")}
                  onClick={() => setCtx((c) => ({ ...c, [it.key]: !c[it.key] }))}
                  title={`${it.label} 컨텍스트를 질문에 첨부`}
                >
                  {it.label}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <div className="tok-wrap" ref={tokenPopRef}>
                <button
                  type="button"
                  className={"tok-badge" + (tokenPopOpen ? " open" : "")}
                  onClick={() => setTokenPopOpen((v) => !v)}
                  aria-expanded={tokenPopOpen}
                  title="예상 입력 토큰 (근사치)"
                >
                  입력 ~{formatTokenCount(estimate?.total ?? 0)} 토큰
                  <ChevronDown size={12} />
                </button>
                {tokenPopOpen && estimate ? (
                  <div className="tok-pop">
                    <div className="tok-pop-title">다음 전송의 예상 입력</div>
                    {estimate.rows.length === 0 ? (
                      <div className="tok-row-empty">첨부된 컨텍스트가 없어요.</div>
                    ) : (
                      estimate.rows.map((r) => (
                        <div className="tok-row" key={r.label}>
                          <span className="tok-row-label">{r.label}</span>
                          <span className="tok-row-bar">
                            <span
                              style={{
                                width:
                                  Math.max(3, Math.round((r.tokens / Math.max(1, estimate.total)) * 100)) + "%",
                              }}
                            />
                          </span>
                          <span className="tok-row-val">~{formatTokenCount(r.tokens)}</span>
                        </div>
                      ))
                    )}
                    <div className="tok-pop-total">
                      <span>합계</span>
                      <span>~{formatTokenCount(estimate.total)} 토큰</span>
                    </div>
                    <div className="tok-pop-note">
                      휴리스틱 근사치예요 (±30%). 매 전송마다 컨텍스트 + 대화 기록 전체가
                      다시 전송됩니다.
                      {estimate.ragPending ? " 코드 검색분은 질문을 입력하면 반영돼요." : ""}
                      {lastAttached.length > 0 ? ` · 지난 전송 첨부: ${lastAttached.join(", ")}` : ""}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="composer-input">
              <textarea
                ref={taRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="무엇이든 물어보세요…  ⏎ 전송 · ⇧⏎ 줄바꿈"
                aria-label="AI 질문 입력"
              />
            </div>

            <div className="composer-foot">
              <div className="model-select" ref={modelMenuRef}>
                <button
                  type="button"
                  className={"model-trigger" + (modelMenuOpen ? " open" : "")}
                  onClick={() => setModelMenuOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  title="모델 선택"
                >
                  <span className="model-dot" style={{ background: VENDOR[provider].color }} />
                  <span className="model-trigger-name">{VENDOR[provider].name}</span>
                  <span className="model-trigger-model">{activeModel}</span>
                  <ChevronDown size={13} />
                </button>
                {modelMenuOpen ? (
                  <div className="model-menu" role="listbox" aria-label="모델 선택">
                    {PROVIDERS.map((p) => {
                      const v = VENDOR[p];
                      const disabled = hasKey[p] === false;
                      return (
                        <button
                          key={p}
                          type="button"
                          role="option"
                          aria-selected={provider === p}
                          className={"model-option" + (provider === p ? " active" : "")}
                          disabled={disabled}
                          onClick={() => {
                            setProvider(p);
                            setModelMenuOpen(false);
                          }}
                          title={disabled ? "설정(⌘,)에서 API 키를 추가하세요" : undefined}
                        >
                          <span className="model-dot" style={{ background: v.color }} />
                          <span className="model-option-name">{v.name}</span>
                          <span className="model-option-model">
                            {disabled ? "키 없음" : providerModel(settings, p)}
                          </span>
                          {provider === p ? <Check size={13} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <span style={{ flex: 1 }} />
              {streaming ? (
                <button
                  type="button"
                  className="btn icon composer-stop"
                  onClick={stop}
                  aria-label="생성 중지"
                  title="생성 중지"
                >
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary icon composer-send"
                  onClick={() => void send()}
                  disabled={!draft.trim()}
                  aria-label="보내기"
                  title="보내기 (⏎)"
                >
                  <ArrowUp size={16} strokeWidth={2.2} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {historyOpen ? (
        <ConversationHistoryModal
          projectId={projectId}
          activeId={threadRef.current}
          onSelect={(id) => void handleSelectThread(id)}
          onNew={() => void handleNewThread()}
          onActiveDeleted={() => void handleActiveDeleted()}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </>
  );
}
