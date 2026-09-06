import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Toolbar } from "@/components/Toolbar";
import {
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
import { useDismiss } from "./useDismiss";
import { useReachability } from "@/features/settings/useReachability";
import { assembleAiContext, type AiContextResult } from "./aiContext";
import {
  MAX_CONTEXT_HOPS,
  parseContextRequest,
  runContextRequest,
  stripContextRequest,
} from "./contextLoad";
import { frozenManifest } from "./manifest";
import { defaultQuestionFor, parseInject } from "./slashInject";
import { contextApi } from "@/api/context";
import { setRecallUsage } from "./recallUsage";
import { ActionProposalCard, extractPlannerAction } from "./aiActions";
import { ConversationHistoryModal } from "./ConversationHistoryModal";
// `useT()` 는 렌더 경로용(언어가 바뀌면 리렌더). `tNow()` 는 모듈 조회로
// **호출 시점의** 언어를 읽는다 — 아이덴티티가 고정이라 deps 에 넣을 필요가
// 없고, deps 에 t 가 빠진 콜백에서도 낡은 언어로 굳지 않는다. DB 에 저장되는
// 대화 제목처럼 한번 잘못 들어가면 영구히 남는 자리에 쓴다.
import { t as tNow, useT } from "@/i18n";
import { tError } from "@/i18n/errors";

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
  anthropic: { name: "Claude", vendor: "Anthropic", color: "#d97757" },
  openai: { name: "GPT", vendor: "OpenAI", color: "#1aa37a" },
  gemini: { name: "Gemini", vendor: "Google", color: "#4a7ad9" },
  nim: { name: "NIM", vendor: "NVIDIA", color: "#76b900" },
  openrouter: { name: "OpenRouter", vendor: "OpenRouter", color: "#6566f1" },
};

// Display message — tracks the provider that produced each assistant turn so
// switching the active model doesn't re-skin past answers (dogfood 발견 2).
/**
 * `fallback` 은 **그 답변 한 건**의 사실이다 (Phase 7 `#offline-fallback`) —
 * 1순위가 아니라 폴백 체인의 누가 이 답을 냈는지. 설정에는 아무 영향이 없고,
 * 대화를 다시 열면(=DB 복원) 사라진다. 그것이 맞다: 폴백은 그때의 사건이지
 * 이 대화의 속성이 아니다.
 */
type ChatMsg = {
  role: Role;
  content: string;
  provider?: Provider;
  fallback?: { provider: string; model: string };
};

type EstimateRow = { label: string; tokens: number };
type Estimate = { total: number; rows: EstimateRow[]; ragPending: boolean };

function secretName(p: Provider): string {
  return `${p}_api_key`;
}

/**
 * 예시 질문 칩의 사전 키.
 *
 * **문자열 배열 상수가 아니라 키 배열이다** — `const SUGGESTIONS = [t(…)]` 로
 * 두면 모듈이 임포트되는 시점의 언어로 굳어 이후 전환이 반영되지 않는다.
 */
const SUGGESTION_KEYS = [
  "ai.suggestStructure",
  "ai.suggestNextSteps",
  "ai.suggestPlannerRisk",
  "ai.suggestCommits",
] as const;

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
  // memo 컴포넌트라 useT() 여야 한다 — 모듈 t() 를 쓰면 props 가 그대로일 때
  // 언어를 바꿔도 이 행만 옛 언어로 남는다.
  const { t } = useT();
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
        {msg.fallback ? (
          <span
            className="chip sm"
            title={t("ai.fallback.hint", {
              provider: msg.fallback.provider,
              model: msg.fallback.model,
            })}
          >
            {t("ai.fallback.badge", { provider: msg.fallback.provider })}
          </span>
        ) : null}
        {isStreamingRow ? (
          <span className="msg-live">
            <span className="msg-live-dot" /> {t("ai.streaming")}
          </span>
        ) : msg.content ? (
          <button
            type="button"
            className="msg-copy"
            onClick={() => void copy()}
            aria-label={t("ai.copyAnswer")}
            title={t("ai.copyAnswer")}
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
            <div className="msg-wait">{t("ai.waiting")}</div>
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
  const { t } = useT();
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
        const created = await commands.conversationCreate(tNow("ai.threadTitle"), provider, null, projectId);
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

  // 오프라인 표시 (Phase 7) — 메뉴를 열 때 마지막 관측을 새로 읽는다.
  const reach = useReachability();
  useEffect(() => {
    if (modelMenuOpen) reach.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelMenuOpen]);

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
            conversationId: threadRef.current,
          });
          if (cancelled) return;
          estCacheRef.current = { key, ctx: aiCtx };
          const rows: EstimateRow[] = aiCtx.parts
            .map((p) => ({ label: p.label, tokens: estimateTokens(p.text) }))
            .filter((r) => r.tokens > 0);
          const hist = estimateMessagesTokens(messages);
          if (hist > 0) rows.push({ label: t("ai.rowHistory", { n: messages.length }), tokens: hist });
          if (query)
            rows.push({
              label: t("ai.rowQuestion"),
              tokens: MESSAGE_OVERHEAD_TOKENS + estimateTokens(query),
            });
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
    const raw = draft.trim();
    if (!raw || streaming) return;
    // 슬래시 결정적 주입 (`#slash-inject`) — 모델의 판단에 기대지 않고 사용자가
    // 확정적으로 본문을 밀어 넣는 경로. 명령은 이번 턴에만 실리고 대화에
    // 남지 않는다.
    const inject = parseInject(raw);
    const trimmed = inject ? inject.question || defaultQuestionFor(inject.name) : raw;
    if (hasKey[provider] === false) {
      setError(t("ai.noApiKey", { vendor: VENDOR[provider].name }));
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
            conversationId: threadRef.current,
          });
    setLastAttached(aiCtx.attached);
    // 관련도 통계는 **실제 전송에서만** 올린다 — 토큰 추정은 타이핑마다
    // 조립하므로 거기서 올리면 키를 칠 때마다 점수가 뛴다. 파생 캐시라
    // 실패해도 대화를 막지 않는다.
    if (projectId != null) {
      for (const used of aiCtx.recallUsed) {
        void contextApi.touch(projectId, used.kind, used.ref).catch(() => {});
      }
    }
    setRecallUsage({
      signal: aiCtx.recall,
      tokens: aiCtx.recallTokens,
      dropped: aiCtx.recallDropped,
      used: aiCtx.recallUsed.length,
    });
    // 왕복에 쓸 매니페스트 — 이번 대화의 **동결된** 것이라 시스템 블록과 같은
    // 목록을 본다 (검색 결과가 프롬프트와 어긋나지 않게).
    const manifestForTurn = await frozenManifest(projectId, threadRef.current);
    // 주입 본문은 **이번 턴 한 번**만 system 앞에 얹는다 — 동결 대상이 아니다.
    const injected = inject ? await runContextRequest(projectId, inject.request, manifestForTurn) : "";
    const systemText = injected ? `${aiCtx.system}\n\n${injected}`.trim() : aiCtx.system;
    if (systemText) {
      llmHistory.unshift({ role: "system" as Role, content: systemText });
    }
    const chatOptions: ChatOptions = {
      model,
      temperature: settings.temperature ?? null,
      max_tokens: settings.maxTokens ?? null,
    };

    // Typewriter: deltas fill `target`; a rAF loop reveals characters with a
    // ~45ms throttle — 마크다운 라이브 렌더의 재파싱 비용을 22fps 로 캡.
    //
    // Phase 5 (`#context-tools`): 한 번의 전송이 **여러 스트림**이 될 수 있다.
    // 모델이 ```json:context``` 로 본문을 요청하면 앱이 읽어 넘기고 이어서 답하게
    // 한다. `assembled` 가 이전 홉들의 확정 텍스트고, `target` 은 지금 홉이다.
    let assembled = "";
    let target = "";
    let shown = 0;
    let receiving = true;
    let aborted = false;
    let lastReveal = 0;

    const renderShown = () => {
      const text = assembled + target.slice(0, shown);
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
        if (assembled || target) renderShown();
        else setMessages((prev) => prev.slice(0, -1)); // 델타 0 — 빈 스텁 제거
        setStreaming(false);
        abortRef.current = null;
        persist(assembled + target);
      } else {
        shown = target.length;
        renderShown();
        finishReveal();
      }
    };

    /** 스트림 한 번. `true` 를 돌려주면 정상 종료, `false` 면 중단·오류다. */
    const runTurn = async (): Promise<boolean> => {
      target = "";
      shown = 0;
      receiving = true;
      lastReveal = 0;

      const channel = new Channel<ChatEvent>();
      channel.onmessage = (event) => {
        if (aborted) return;
        if (event.kind === "delta") {
          target += event.text;
          if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
        } else if (event.kind === "fallback") {
          // 1순위가 아니라 폴백이 답했다 — 그 사실을 답변 행에 배지로 남긴다.
          // **설정은 건드리지 않는다**: 이번 호출 한 번의 사건이다.
          const mark = { provider: event.provider, model: event.model };
          setMessages((prev) =>
            prev.map((m, i) => (i === prev.length - 1 ? { ...m, fallback: mark } : m)),
          );
        } else if (event.kind === "error") {
          setError(event.message);
        }
      };

      let res;
      try {
        res = await commands.chatStream(provider, llmHistory, chatOptions, parseFallbacks(settings), channel);
      } catch (err) {
        if (aborted) return false;
        receiving = false;
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        setError(String(err));
        setStreaming(false);
        abortRef.current = null;
        setMessages((prev) => prev.slice(0, -1));
        return false;
      }
      if (aborted) return false;
      receiving = false; // backend done sending — let the typewriter drain the rest
      if (res.status === "error") {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        setError(tError(res.error));
        setMessages((prev) => prev.slice(0, -1));
        setStreaming(false);
        abortRef.current = null;
        return false;
      }
      return true;
    };

    // ── 왕복 루프 ────────────────────────────────────────────────────────
    //
    // 도구 호출이 없는 어댑터 위에서 "필요하면 꺼내 온다" 를 성립시키는 자리다
    // (contextLoad.ts 의 주석 참고). 홉 상한이 있으므로 무한 왕복은 없다.
    for (let hop = 0; ; hop += 1) {
      const ok = await runTurn();
      if (!ok) return;

      const request = hop < MAX_CONTEXT_HOPS ? parseContextRequest(target) : null;
      if (!request) break;

      // 요청 블록은 사용자에게 보일 이유가 없다 — 걷어내고 그 자리에 이어 쓴다.
      const spoken = stripContextRequest(target);
      assembled += spoken ? `${spoken}\n\n` : "";
      shown = 0;
      target = "";
      renderShown();

      const loaded = await runContextRequest(projectId, request, manifestForTurn);
      llmHistory.push({ role: "assistant" as Role, content: spoken || "(컨텍스트 요청)" }); // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
      llmHistory.push({ role: "user" as Role, content: loaded });
    }

    if (!rafRef.current) {
      // No deltas arrived (or already drained) — finalize immediately.
      shown = target.length;
      renderShown();
      finishReveal();
    }
    // else: the running tick loop reveals the remainder and clears `streaming`.

    // Persist the FULL text (not the partially-revealed display).
    const finalText = assembled + target;
    if (finalText) persist(finalText);
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
    const res = await commands.conversationCreate(
      tNow("ai.newThread"),
      provider,
      null,
      projectId,
    );
    if (res.status === "ok") await loadThread(res.data.id);
    setHistoryOpen(false);
  }, [provider, projectId, loadThread]);

  // The active conversation was deleted — fall back to the most recent or a new one.
  const handleActiveDeleted = useCallback(async () => {
    const listRes = await commands.conversationList(projectId);
    const convs = listRes.status === "ok" ? listRes.data : [];
    let id = convs[0]?.id ?? null;
    if (id == null) {
      const created = await commands.conversationCreate(tNow("ai.threadTitle"), provider, null, projectId);
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
      <Toolbar title={t("nav.ai")} sub={t("ai.toolbarSub")}>
        <button
          className="btn"
          onClick={() => void handleNewThread()}
          title={t("ai.newThreadTitle")}
        >
          <SquarePen size={15} /> {t("ai.newThread")}
        </button>
        <button className="btn" onClick={() => setHistoryOpen(true)} title={t("ai.historyBtn")}>
          <History size={15} /> {t("ai.historyBtn")}
        </button>
      </Toolbar>

      <div className="ai-wrap">
        <div className="ai-thread" ref={scrollRef} onScroll={handleScroll}>
          <div className="ai-thread-inner">
            {messages.length === 0 ? (
              keysResolved && !anyKey ? (
                <div className="ai-start">
                  <div className="ai-start-title">{t("ai.heroNoKeyTitle")}</div>
                  <div className="ai-start-sub">
                    <button
                      type="button"
                      className="set-link"
                      onClick={() => setUiV2View("settings")}
                    >
                      {t("ai.heroAddKey")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ai-start">
                  {/* 제목은 프로젝트 이름 — "무엇이든 물어보세요" 는 챗봇 관용구다.
                      이 대화가 무엇을 아는지(이 프로젝트)를 첫 줄이 말한다. */}
                  <div className="ai-start-title">{state.currentProjectName ?? t("nav.ai")}</div>
                  <div className="ai-start-sub">{t("ai.heroSub")}</div>
                  <div className="ai-start-label">{t("ai.startLabel")}</div>
                  <ul className="ai-start-list">
                    {SUGGESTION_KEYS.map((key) => {
                      const text = t(key);
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            className="ai-start-item"
                            onClick={() => {
                              setDraft(text);
                              taRef.current?.focus();
                            }}
                          >
                            {text}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
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
          {!atBottom ? (
            <button
              type="button"
              className="ai-scroll-fab"
              onClick={scrollToBottom}
              aria-label={t("ai.scrollBottom")}
              title={t("ai.scrollBottom")}
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
                  { key: "rag", labelKey: "ai.chipCode" },
                  { key: "oculpm", labelKey: "ai.chipJournal" },
                  { key: "planner", labelKey: "ai.chipPlanner" },
                  { key: "git", labelKey: "ai.chipGit" },
                ] as const
              ).map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className={"scope-chip" + (ctx[it.key] ? " on" : "")}
                  onClick={() => setCtx((c) => ({ ...c, [it.key]: !c[it.key] }))}
                  title={t("ai.chipAttach", { label: t(it.labelKey) })}
                >
                  {t(it.labelKey)}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <div className="tok-wrap" ref={tokenPopRef}>
                <button
                  type="button"
                  className={"tok-badge" + (tokenPopOpen ? " open" : "")}
                  onClick={() => setTokenPopOpen((v) => !v)}
                  aria-expanded={tokenPopOpen}
                  title={t("ai.tokenBadgeTitle")}
                >
                  {t("ai.tokenBadge", { n: formatTokenCount(estimate?.total ?? 0) })}
                  <ChevronDown size={12} />
                </button>
                {tokenPopOpen && estimate ? (
                  <div className="tok-pop">
                    <div className="tok-pop-title">{t("ai.tokenPopTitle")}</div>
                    {estimate.rows.length === 0 ? (
                      <div className="tok-row-empty">{t("ai.tokenPopEmpty")}</div>
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
                      <span>{t("ai.tokenTotal")}</span>
                      <span>{t("ai.tokenTotalValue", { n: formatTokenCount(estimate.total) })}</span>
                    </div>
                    <div className="tok-pop-note">
                      {t("ai.tokenNote")}
                      {estimate.ragPending ? t("ai.tokenNoteRag") : ""}
                      {lastAttached.length > 0
                        ? t("ai.tokenNoteAttached", { list: lastAttached.join(", ") })
                        : ""}
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
                  // 한글 조합을 확정하는 Enter 가 문장을 전송하면 안 된다
                  // (isComposing 을 늦게 세팅하는 엔진이 있어 keyCode 229 도 본다).
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={t("ai.placeholder")}
                aria-label={t("ai.inputAria")}
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
                  title={t("ai.modelSelect")}
                >
                  <span className="model-dot" style={{ background: VENDOR[provider].color }} />
                  <span className="model-trigger-name">{VENDOR[provider].name}</span>
                  <span className="model-trigger-model">{activeModel}</span>
                  <ChevronDown size={13} />
                </button>
                {modelMenuOpen ? (
                  <div className="model-menu" role="listbox" aria-label={t("ai.modelSelect")}>
                    {PROVIDERS.map((p) => {
                      const v = VENDOR[p];
                      const disabled = hasKey[p] === false;
                      // 못 닿는 프로바이더는 **흐리게만** 한다 — 숨기면 설정이
                      // 날아간 줄 알고, 막으면 복구된 순간 고를 수가 없다.
                      const offline = reach.offline(p);
                      const hint = disabled
                        ? t("ai.needKeyHint")
                        : offline
                          ? `${t("llm.offline.hint")}${reach.detail(p) ? ` (${reach.detail(p)})` : ""}`
                          : undefined;
                      return (
                        <button
                          key={p}
                          type="button"
                          role="option"
                          aria-selected={provider === p}
                          className={
                            "model-option" +
                            (provider === p ? " active" : "") +
                            (offline && !disabled ? " unreachable" : "")
                          }
                          disabled={disabled}
                          onClick={() => {
                            setProvider(p);
                            setModelMenuOpen(false);
                          }}
                          title={hint}
                        >
                          <span className="model-dot" style={{ background: v.color }} />
                          <span className="model-option-name">{v.name}</span>
                          <span className="model-option-model">
                            {disabled
                              ? t("ai.noKey")
                              : offline
                                ? t("llm.offline.badge")
                                : providerModel(settings, p)}
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
                  aria-label={t("ai.stop")}
                  title={t("ai.stop")}
                >
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary icon composer-send"
                  onClick={() => void send()}
                  disabled={!draft.trim()}
                  aria-label={t("ai.send")}
                  title={t("ai.sendHint")}
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
