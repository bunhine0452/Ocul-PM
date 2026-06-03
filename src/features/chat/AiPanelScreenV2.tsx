import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Toolbar } from "@/components/Toolbar";
import { SparklesIcon, Paperclip, ArrowUp, History, TriangleAlert } from "@/components/Icons";
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
import { PROVIDERS, providerModel, type Provider } from "@/lib/settings";

// Final UI Update (ui_v2) — AI 패널 화면 (02-screen-specs §7). Mockup
// .ai-wrap/.ai-models/.ai-thread/.ai-compose visuals + the chatStream
// streaming loop extracted from the legacy ChatPanel (Channel<ChatEvent> →
// delta accumulation → chatMessageAppend persistence). flag-off ChatPanel /
// AiOverlay untouched. The active conversation id is shared with the overlay
// via WorkspaceContext.aiThreadId; the active provider via aiActiveModel.

const VENDOR: Record<Provider, { name: string; vendor: string; color: string }> = {
  anthropic: { name: "Claude", vendor: "Anthropic", color: "#d97a4f" },
  openai: { name: "GPT", vendor: "OpenAI", color: "#1aa37a" },
  gemini: { name: "Gemini", vendor: "Google", color: "#4a7ad9" },
  nim: { name: "NIM", vendor: "NVIDIA", color: "#76b900" },
};

// Display message — tracks the provider that produced each assistant turn so
// switching the active model doesn't re-skin past answers (dogfood 발견 2).
type ChatMsg = { role: Role; content: string; provider?: Provider };

function secretName(p: Provider): string {
  return `${p}_api_key`;
}

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
  // Keyring presence per provider (null = checking). Models without a key are
  // disabled (dogfood 발견 4).
  const [hasKey, setHasKey] = useState<Record<Provider, boolean | null>>({
    anthropic: null,
    openai: null,
    gemini: null,
    nim: null,
  });
  const threadRef = useRef<number | null>(
    state.aiThreadId != null ? Number(state.aiThreadId) : null,
  );
  const threadInnerRef = useRef<HTMLDivElement | null>(null);

  // Resolve or create the shared conversation thread on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Reuse the parked thread if it still exists, else the most recent, else
      // create one. The overlay reads the same aiThreadId.
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

  // Auto-scroll the thread on new content.
  useEffect(() => {
    const el = threadInnerRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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

    // chatStream wants plain {role, content} — strip the display-only provider.
    const llmHistory: Message[] = [...baseHistory, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (settings.systemPrompt.trim()) {
      llmHistory.unshift({ role: "system" as Role, content: settings.systemPrompt });
    }
    const chatOptions: ChatOptions = {
      model,
      temperature: settings.temperature ?? null,
      max_tokens: settings.maxTokens ?? null,
    };

    let acc = "";
    const channel = new Channel<ChatEvent>();
    channel.onmessage = (event) => {
      if (event.kind === "delta") {
        acc += event.text;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant" as Role, content: acc, provider };
          return next;
        });
      } else if (event.kind === "error") {
        setError(event.message);
      }
    };

    let res;
    try {
      res = await commands.chatStream(provider, llmHistory, chatOptions, channel);
    } catch (err) {
      setError(String(err));
      setStreaming(false);
      setMessages((prev) => prev.slice(0, -1));
      return;
    }
    if (res.status === "error") {
      setError(res.error);
      setMessages((prev) => prev.slice(0, -1));
      setStreaming(false);
      return;
    }
    setStreaming(false);

    // Best-effort persistence to the shared thread.
    const id = threadRef.current;
    if (id != null && acc) {
      void commands.chatMessageAppend(id, "user", trimmed, provider, model);
      void commands.chatMessageAppend(id, "assistant", acc, provider, model);
    }
  }, [draft, streaming, messages, provider, settings, hasKey]);

  return (
    <>
      <Toolbar title="AI 패널" sub="여러 LLM에 같은 컨텍스트로 질문">
        <button className="btn" disabled title="대화 기록 (1.1)">
          <History size={15} /> 대화 기록
        </button>
      </Toolbar>

      <div className="ai-wrap">
        <div className="ai-models">
          <span className="section-title" style={{ marginRight: 4 }}>모델</span>
          {PROVIDERS.map((p) => {
            const v = VENDOR[p];
            const disabled = hasKey[p] === false;
            return (
              <button
                key={p}
                type="button"
                className={"model-chip" + (provider === p ? " active" : "")}
                onClick={() => {
                  if (!disabled) setProvider(p);
                }}
                disabled={disabled}
                title={disabled ? "설정(⌘,)에서 API 키를 추가하세요" : undefined}
              >
                <span className="model-dot" style={{ background: v.color }} />
                {v.name}
                <span className="model-vendor">{disabled ? "키 없음" : v.vendor}</span>
              </button>
            );
          })}
        </div>

        <div className="ai-thread">
          <div className="ai-thread-inner" ref={threadInnerRef}>
            {messages.length === 0 ? (
              keysResolved && !anyKey ? (
                <div className="empty-hint">
                  사용할 수 있는 API 키가 없어요.{" "}
                  <button
                    type="button"
                    className="set-link"
                    onClick={() => setUiV2View("settings")}
                  >
                    설정에서 키 추가 →
                  </button>
                </div>
              ) : (
                <div className="empty-hint">코드베이스에 대해 무엇이든 물어보세요.</div>
              )
            ) : (
              messages.map((m, i) => {
                // Per-message provider so changing the active model doesn't
                // re-skin past answers (dogfood 발견 2).
                const mp = m.provider ?? provider;
                const isLast = i === messages.length - 1;
                return (
                  <div className={"msg " + m.role} key={i}>
                    <div
                      className="msg-av"
                      style={m.role === "assistant" ? { background: VENDOR[mp].color } : undefined}
                    >
                      {m.role === "user" ? "나" : <SparklesIcon size={15} />}
                    </div>
                    <div className="msg-body">
                      <div className="msg-name">
                        {m.role === "user" ? (
                          "나"
                        ) : (
                          <>
                            {VENDOR[mp].name}
                            <span className="vendor">로컬 컨텍스트 첨부됨</span>
                          </>
                        )}
                      </div>
                      <div className="msg-text">
                        {m.role === "assistant" ? (
                          m.content ? (
                            <Markdown>{m.content}</Markdown>
                          ) : streaming && isLast ? (
                            "…"
                          ) : (
                            ""
                          )
                        ) : (
                          m.content
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {error ? (
              <div className="msg assistant">
                <div className="msg-av" style={{ background: "var(--t-bug)" }}>
                  <TriangleAlert size={15} />
                </div>
                <div className="msg-body">
                  <div className="msg-name">오류</div>
                  <div className="msg-text" style={{ color: "var(--t-bug)" }}>{error}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="ai-compose">
          <div className="compose-ctx">
            <Paperclip size={13} />
            <span>전체 코드베이스는 로컬에만 저장됩니다</span>
          </div>
          <div className="compose-box">
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="코드베이스에 대해 무엇이든 물어보세요…"
              aria-label="AI 질문 입력"
            />
            <button
              type="button"
              className="btn primary icon"
              style={{ width: 34, height: 34 }}
              onClick={() => void send()}
              disabled={!draft.trim() || streaming}
              aria-label="보내기"
            >
              <ArrowUp size={16} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
