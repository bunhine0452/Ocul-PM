import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { useSettings } from "@/contexts/SettingsContext";
import { providerModel, parseFallbacks } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "@/components/Icons";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/Markdown";
import {
  commands,
  type ChatEvent,
  type ChunkSearchResult,
  type Conversation,
  type Message,
  type Project,
  type Role,
} from "@/lib/bindings";

import {
  buildContextSystem,
  buildGitSystemContext,
  buildPlannerSystemContext,
  buildOculpmSystemContext,
} from "./aiContext";
import {
  ActionProposalCard,
  extractPlannerAction,
  buildActionInstruction,
} from "./aiActions";

const PROVIDERS = ["anthropic", "gemini", "openai", "nim", "openrouter"] as const;
type Provider = (typeof PROVIDERS)[number];

const CONTEXT_DEBOUNCE_MS = 400;
const TITLE_MAX = 40;

function deriveTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > TITLE_MAX
    ? trimmed.slice(0, TITLE_MAX) + "…"
    : trimmed || "New conversation";
}

interface ChatPanelProps {
  isWorkspaceMode?: boolean;
  activeProjectId?: number | null;
  activeFile?: string | null;
  /**
   * When true (e.g. embedded inside AiWorkbench's narrow 380px panel), the
   * inline conversation list is replaced by a popover trigger so the chat
   * thread itself gets the full width. Avoids the "사이드바 + 본문" 두 컬럼이
   * 좁은 폭에서 함께 뭉개지는 버그.
   */
  compactSidebar?: boolean;
  /** When provided from AiWorkbench, overrides the internal provider state. */
  externalProvider?: Provider;
  /** When provided from AiWorkbench, overrides the internal model state. */
  externalModel?: string;
}

/**
 * One-time migration: scan localStorage for legacy `action_${convId}_${i}` keys
 * (where the value is the literal "applied"), forward each to the SQLite
 * `conversation_actions` table via `record_conversation_action`, then delete
 * the keys. Guard with a sentinel so the scan runs at most once per install.
 *
 * Kept inside ChatPanel because that's the only place those keys were ever
 * written; after this migration ships, the file should be removable from the
 * eslint allowlist in `scripts/check-no-localstorage.mjs`.
 */
const MIGRATION_SENTINEL = "aipm:conv_actions_migrated:v1";
async function migrateLegacyActionKeys() {
  if (localStorage.getItem(MIGRATION_SENTINEL) === "done") return;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("action_")) continue;
    if (localStorage.getItem(key) !== "applied") continue;
    const parts = key.split("_");
    // action_${convId}_${i}
    if (parts.length !== 3) continue;
    const convId = Number(parts[1]);
    const msgIdx = Number(parts[2]);
    if (Number.isNaN(convId) || Number.isNaN(msgIdx)) continue;
    try {
      await commands.recordConversationAction(convId, msgIdx, "applied");
      toRemove.push(key);
    } catch (e) {
      console.warn("conv-action migration: failed for", key, e);
    }
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
  localStorage.setItem(MIGRATION_SENTINEL, "done");
}

export function ChatPanel({
  isWorkspaceMode = false,
  activeProjectId = null,
  activeFile = null,
  compactSidebar = false,
  externalProvider,
  externalModel,
}: ChatPanelProps) {
  const { settings } = useSettings();
  // Popover open-state for the compact conversation switcher.
  const [convPopoverOpen, setConvPopoverOpen] = useState(false);

  // Fire the legacy localStorage → SQLite migration once on mount. Async +
  // await-less because we don't want to block the chat UI on it.
  useEffect(() => {
    void migrateLegacyActionKeys();
  }, []);

  const [internalProvider, setInternalProvider] = useState<Provider>(settings.defaultProvider as Provider);
  const [internalModel, setInternalModel] = useState("");

  // When external provider/model is given (from AiWorkbench), use it.
  const provider = externalProvider ?? internalProvider;
  const setProvider = externalProvider ? () => {} : setInternalProvider;
  const model = externalModel ?? internalModel;
  const setModel = externalModel !== undefined ? () => {} : setInternalModel;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [contextProjectId, setContextProjectId] = useState<number | null>(activeProjectId);
  const [includePlanner, setIncludePlanner] = useState(true);
  const [includeGit, setIncludeGit] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => {
    if (activeProjectId !== null) {
      setContextProjectId(activeProjectId);
    }
  }, [activeProjectId]);

  // Lite-W6 PR6.5: LocalDiffView's "AI 에게 설명" button fires this event
  // with a prompt prefilled from the active diff. We replace the current
  // input so the user can edit before sending; if the field already has
  // user text we prepend the diff prompt as a separate block.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ prompt: string }>;
      const prompt = ce.detail?.prompt;
      if (typeof prompt !== "string" || !prompt) return;
      setInput((prev) => (prev.trim() ? `${prompt}\n\n${prev}` : prompt));
    };
    window.addEventListener("ai-overlay:prefill", handler);
    return () => window.removeEventListener("ai-overlay:prefill", handler);
  }, []);
  const [chunksByTurn, setChunksByTurn] = useState<Record<number, ChunkSearchResult[]>>(
    {},
  );

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<number | null>(null);
  const hydratingRef = useRef(false);

  useEffect(() => {
    (async () => {
      const saved = await commands.settingsGet("default_model");
      if (saved.status === "ok" && saved.data) setModel(saved.data);

      const ps = await commands.listProjects();
      if (ps.status === "ok") setProjects(ps.data);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const cs = await commands.conversationList(contextProjectId);
      if (cs.status === "ok") setConversations(cs.data);
    })();
  }, [contextProjectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  // Load a conversation's messages + restore its provider/model/context.
  useEffect(() => {
    if (currentConvId == null) return;
    if (pending) return;
    const conv = conversations.find((c) => c.id === currentConvId);
    if (!conv) return;

    hydratingRef.current = true;
    (async () => {
      try {
        const res = await commands.chatMessageList(currentConvId);
        if (res.status === "ok") {
          setMessages(
            res.data.map((m) => ({ role: m.role as Role, content: m.content })),
          );
        } else {
          setError(res.error);
        }
        if (conv.provider && (PROVIDERS as readonly string[]).includes(conv.provider)) {
          setProvider(conv.provider as Provider);
        }
        if (conv.model != null) setModel(conv.model);
        setContextProjectId(conv.project_id ?? null);
        setChunksByTurn({});
        setError(null);
      } finally {
        // Defer so the state-update render finishes before the context effect re-runs.
        setTimeout(() => {
          hydratingRef.current = false;
        }, 0);
      }
    })();
    // We intentionally do not depend on `conversations` here — sidebar selection
    // pre-populates conversations, and we don't want a list refresh to re-hydrate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConvId]);

  // Persist provider/model/context changes to the active conversation, debounced.
  useEffect(() => {
    if (currentConvId == null || hydratingRef.current) return;
    const conv = conversations.find((c) => c.id === currentConvId);
    if (!conv) return;

    const sameProvider = (conv.provider ?? null) === provider;
    const sameModel = (conv.model ?? null) === (model || null);
    const sameContext = (conv.project_id ?? null) === contextProjectId;
    if (sameProvider && sameModel && sameContext) return;

    const handle = setTimeout(() => {
      commands.conversationSetContext(
        currentConvId,
        provider,
        model || null,
        contextProjectId,
      );
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConvId
            ? { ...c, provider, model: model || null, project_id: contextProjectId }
            : c,
        ),
      );
    }, CONTEXT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [provider, model, contextProjectId, currentConvId, conversations]);

  async function handleOptimizePrompt() {
    const text = input.trim();
    if (!text || optimizing || pending) return;

    setOptimizing(true);
    setError(null);
    try {
      const effectiveModel = model || providerModel(settings, provider);
      
      const optimizeSystemPrompt = `You are a professional software engineering prompt optimizer. Your task is to translate the user's request into English if it is in Korean (or vice-versa, or optimize it for code RAG tasks) to generate a highly detailed and clear prompt for software engineering tasks. Keep the core meaning exactly the same, but structure it for optimal LLM completion. Output ONLY the optimized prompt content, nothing else. No introductions, no explanations, no markdown code block fences unless the user requested code blocks in the output.`;

      const response = await commands.chat(
        provider,
        [
          { role: "system", content: optimizeSystemPrompt },
          { role: "user", content: `USER REQUEST:\n${text}` }
        ],
        {
          model: effectiveModel,
          temperature: 0.3,
          max_tokens: 1000
        },
        parseFallbacks(settings),
      );

      if (response.status === "ok") {
        setInput(response.data.content.trim());
      } else {
        setError(`Prompt optimization failed: ${response.error}`);
      }
    } catch (err: any) {
      setError(`Error optimizing prompt: ${err.toString()}`);
    } finally {
      setOptimizing(false);
    }
  }

  function bumpConvToTop(convId: number) {
    const now = Math.floor(Date.now() / 1000);
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === convId);
      if (idx < 0) return prev;
      const updated = { ...prev[idx], last_message_at: now, updated_at: now };
      return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || pending) return;

    // 1. Ensure a conversation row exists.
    let convId = currentConvId;
    if (convId == null) {
      const effectiveModel = model || providerModel(settings, provider);
      const created = await commands.conversationCreate(
        deriveTitle(text),
        provider,
        effectiveModel,
        contextProjectId,
      );
      if (created.status === "error") {
        setError(created.error);
        return;
      }
      convId = created.data.id;
      setCurrentConvId(convId);
      setConversations((prev) => [created.data, ...prev]);
    }

    // 2. Persist the user message before doing anything else.
    const userPersist = await commands.chatMessageAppend(
      convId,
      "user",
      text,
      null,
      null,
    );
    if (userPersist.status === "error") {
      setError(userPersist.error);
      return;
    }

    const userMsg: Message = { role: "user", content: text };
    const placeholder: Message = { role: "assistant", content: "" };
    const baseHistory = [...messages, userMsg];
    const userIndex = baseHistory.length - 1;

    setMessages([...baseHistory, placeholder]);
    setInput("");
    setPending(true);
    setError(null);

    let systemPromptContent = "";
    let chunks: ChunkSearchResult[] = [];

    if (contextProjectId != null && activeFile) {
      try {
        const fileRes = await commands.readProjectFile(contextProjectId, activeFile);
        if (fileRes.status === "ok") {
          systemPromptContent += `### Currently Open File in Editor: \`${activeFile}\`\n\`\`\`\n${fileRes.data}\n\`\`\`\n\n`;
        }
      } catch (err) {
        console.error("Failed to read active file context:", err);
      }
    }

    if (contextProjectId != null && settings.ragTopK > 0) {
      // RAG context is code, not prose — exclude docs (.md/.txt/…).
      const res = await commands.searchChunks(contextProjectId, text, settings.ragTopK, false);
      if (res.status === "ok" && res.data.length > 0) {
        chunks = res.data;
        systemPromptContent += buildContextSystem(chunks) + "\n\n";
      } else if (res.status === "error") {
        setError(`Context search failed: ${res.error}`);
      }
    }

    // Prepend the user's custom system prompt, if set.
    if (settings.systemPrompt.trim()) {
      systemPromptContent = settings.systemPrompt.trim() + "\n\n" + systemPromptContent;
    }


    if (includePlanner) {
      const plannerContext = await buildPlannerSystemContext(contextProjectId);
      if (plannerContext) {
        systemPromptContent += plannerContext + "\n\n";
      }
      systemPromptContent += buildActionInstruction() + "\n\n";
    }

    if (includeGit) {
      const gitContext = await buildGitSystemContext(contextProjectId);
      if (gitContext) {
        systemPromptContent += gitContext + "\n\n";
      }
    }

    // Feature 2 — recent journal entries + AGENTS rules, so the assistant keeps
    // the same direction across sessions / model swaps.
    if (settings.includeOculpmContext) {
      const oculpmContext = await buildOculpmSystemContext(
        contextProjectId,
        settings.oculpmContextEntries,
      );
      if (oculpmContext) {
        systemPromptContent += oculpmContext + "\n\n";
      }
    }

    let llmHistory = baseHistory;
    if (systemPromptContent.trim()) {
      llmHistory = [
        { role: "system", content: systemPromptContent.trim() },
        ...baseHistory,
      ];
    }
    setChunksByTurn((prev) => ({ ...prev, [userIndex]: chunks }));

    let finalContent = "";
    const channel = new Channel<ChatEvent>();
    channel.onmessage = (event) => {
      if (event.kind === "delta") {
        finalContent += event.text;
        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + event.text };
          }
          return next;
        });
      } else if (event.kind === "error") {
        setError(event.message);
      }
    };

    const effectiveModel = model || providerModel(settings, provider);
    const chatOptions = {
      model: effectiveModel,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
    };

    let res;
    const fallbacks = parseFallbacks(settings);
    if (settings.streamResponses) {
      res = await commands.chatStream(provider, llmHistory, chatOptions, fallbacks, channel);
    } else {
      const r = await commands.chat(provider, llmHistory, chatOptions, fallbacks);
      if (r.status === "ok") {
        finalContent = r.data.content;
        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: finalContent };
          }
          return next;
        });
        res = { status: "ok" as const, data: null };
      } else {
        res = { status: "error" as const, error: r.error };
      }
    }

    if (res.status === "error") {
      setError(res.error);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.content === "") {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } else if (finalContent) {
      // 3. Persist the assistant turn.
      await commands.chatMessageAppend(
        convId,
        "assistant",
        finalContent,
        provider,
        effectiveModel,
      );
      bumpConvToTop(convId);
    }
    setPending(false);
  }

  function startNewChat() {
    if (pending) return;
    setCurrentConvId(null);
    setMessages([]);
    setChunksByTurn({});
    setError(null);
  }

  async function renameConversation(id: number, title: string) {
    const next = title.trim() || "Untitled";
    const res = await commands.conversationRename(id, next);
    if (res.status === "ok") {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: next } : c)),
      );
    } else {
      setError(res.error);
    }
  }

  async function deleteConversation(id: number) {
    if (!confirm("이 대화를 삭제할까요? 모든 메시지가 함께 삭제됩니다.")) return;
    const res = await commands.conversationDelete(id);
    if (res.status === "ok") {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConvId === id) startNewChat();
    } else {
      setError(res.error);
    }
  }

  const contextProject = projects.find((p) => p.id === contextProjectId);

  if (isWorkspaceMode) {
    return (
      <div className="w-full h-full flex flex-col bg-background overflow-hidden">
        {/* Workspace-aligned Chat Header */}
        <div className="h-12 border-b border-border flex items-center justify-between px-4 bg-secondary/20 shrink-0 gap-2 min-w-0">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            {!compactSidebar && (
              <span className="text-sm font-bold text-foreground shrink-0">AI Code Chat</span>
            )}
            <span className="text-xs text-muted-foreground bg-accent px-1.5 py-0.5 rounded font-medium truncate">
              {compactSidebar ? contextProject?.name ?? "No Project" : `Context: ${contextProject?.name ?? "No Project selected"}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {compactSidebar && (
              // Replaces the inline 224px conversations sidebar with a popover.
              // The chat thread itself reclaims the full container width.
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConvPopoverOpen((o) => !o)}
                  className="text-xs h-8 rounded-lg cursor-pointer"
                  title="대화 목록"
                >
                  💬 {conversations.length}
                </Button>
                {convPopoverOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setConvPopoverOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-20 w-64 max-h-80 overflow-y-auto bg-card border border-border rounded-lg shadow-lg p-2">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground/60 tracking-wider mb-1 px-1">
                        Conversations
                      </div>
                      <ConversationSidebar
                        conversations={conversations}
                        currentConvId={currentConvId}
                        onSelect={(id) => {
                          if (!pending) {
                            setCurrentConvId(id);
                            setConvPopoverOpen(false);
                          }
                        }}
                        onRename={renameConversation}
                        onDelete={deleteConversation}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={startNewChat}
              disabled={pending || (currentConvId == null && messages.length === 0)}
              className="text-xs h-8 rounded-lg cursor-pointer"
            >
              + New
            </Button>
          </div>
        </div>

        {/* Workspace Chat Grid Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Conversation list — inline sidebar in full layout, popover in compact. */}
          {!compactSidebar && (
            <div className="w-56 border-r border-border p-3 flex flex-col bg-sidebar select-none shrink-0 overflow-y-auto">
              <div className="text-[10px] uppercase font-bold text-muted-foreground/60 tracking-wider mb-2 px-1">
                Conversations
              </div>
              <ConversationSidebar
                conversations={conversations}
                currentConvId={currentConvId}
                onSelect={(id) => !pending && setCurrentConvId(id)}
                onRename={renameConversation}
                onDelete={deleteConversation}
              />
            </div>
          )}

          {/* Active Chat message area */}
          <div className="flex-1 flex flex-col overflow-hidden bg-background">
            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
              {messages.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted-foreground/60">
                  <span className="text-3xl mb-3">💬</span>
                  <p className="text-xs font-semibold text-center leading-relaxed">
                    Start a new conversation to ask questions about this codebase.
                    <br />
                    Relevant context is auto-injected from your files.
                  </p>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} mb-4`}
                >
                  <div
                    className={`px-4 py-3 rounded-2xl max-w-[85%] text-xs ${
                      m.role === "user"
                        ? "bg-primary/10 text-foreground rounded-tr-sm"
                        : "bg-muted/30 text-foreground rounded-tl-sm border border-border/50"
                    }`}
                  >
                    {m.role === "assistant" ? (
                      m.content ? (
                        (() => {
                          const { cleanText, action } = extractPlannerAction(m.content);
                          const isStreaming = pending && i === messages.length - 1;
                          // W5 — apply-state moved from localStorage["action_${convId}_${i}"]
                          // to SQLite `conversation_actions`. We pass the raw
                          // (conversationId, messageIndex) instead of a composed key.
                          return (
                            <div className="space-y-1 max-w-none">
                              <div className="prose prose-sm text-xs leading-relaxed">
                                <Markdown>{cleanText}</Markdown>
                              </div>
                              {action && !isStreaming && (
                                <ActionProposalCard
                                  action={action}
                                  conversationId={currentConvId}
                                  messageIndex={i}
                                  projectId={contextProjectId}
                                  onApplied={() => window.dispatchEvent(new CustomEvent("refresh-planner"))}
                                />
                              )}

                            </div>
                          );
                        })()
                      ) : pending && i === messages.length - 1 ? (
                        <div className="text-muted-foreground italic flex items-center gap-1.5">
                          <span className="animate-pulse">●</span>
                          <span className="animate-pulse delay-75">●</span>
                          <span className="animate-pulse delay-150">●</span>
                        </div>
                      ) : null
                    ) : (
                      <>
                        <div className="whitespace-pre-wrap leading-relaxed">
                          {m.content}
                        </div>
                        {chunksByTurn[i] && chunksByTurn[i].length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border/50">
                            <ContextBadge chunks={chunksByTurn[i]} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Input field controls */}
            <div className="p-4 border-t border-border bg-secondary/10 shrink-0">
              <div className="max-w-4xl mx-auto flex flex-col gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Ask a question about this project (⌘/Ctrl + Enter to send)"
                  rows={2}
                  className="resize-none rounded-xl bg-background border-border/50 focus-visible:ring-primary shadow-sm p-3 text-xs"
                  disabled={pending || optimizing}
                />

                <div className="flex gap-2 w-full">
                  <Button
                    type="button"
                    onClick={handleOptimizePrompt}
                    disabled={!input.trim() || pending || optimizing}
                    className="flex-1 border border-border bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground rounded-xl h-9 font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {optimizing ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Optimizing...</span>
                      </>
                    ) : (
                      <>
                        <span>🪄</span>
                        <span>Optimize Prompt</span>
                      </>
                    )}
                  </Button>

                  <Button
                    onClick={send}
                    disabled={!input.trim() || pending || optimizing}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl h-9 font-semibold text-[11px] flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    {pending ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Thinking...</span>
                      </>
                    ) : (
                      <span>Send</span>
                    )}
                  </Button>
                </div>

                {error && (
                  <p className="text-xs text-destructive whitespace-pre-wrap font-mono mt-1">
                    {error}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="w-full max-w-6xl rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-border/50 pb-4 mb-4">
        <h2 className="text-xl font-heading font-semibold">Chat</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={startNewChat}
          disabled={pending || (currentConvId == null && messages.length === 0)}
          className="text-muted-foreground hover:text-foreground rounded-md"
        >
          + New Chat
        </Button>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-4">
        <ConversationSidebar
          conversations={conversations}
          currentConvId={currentConvId}
          onSelect={(id) => !pending && setCurrentConvId(id)}
          onRename={renameConversation}
          onDelete={deleteConversation}
        />

        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-[1fr_2fr] gap-2 items-center">
            <Label className="text-xs uppercase text-muted-foreground tracking-wider">
              Provider
            </Label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.currentTarget.value as Provider)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              disabled={pending}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <Label className="text-xs uppercase text-muted-foreground tracking-wider">
              Model
            </Label>
            <input
              value={model}
              onChange={(e) => setModel(e.currentTarget.value)}
              placeholder={providerModel(settings, provider)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm font-mono"
              disabled={pending}
            />

            <Label className="text-xs uppercase text-muted-foreground tracking-wider">
              Context
            </Label>
            <select
              value={contextProjectId ?? ""}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setContextProjectId(v === "" ? null : Number(v));
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              disabled={pending}
              title="Auto-inject top-K relevant chunks from a project on every turn"
            >
              <option value="">No context</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <Label className="text-xs uppercase text-muted-foreground tracking-wider">
              Planner
            </Label>
            <div className="flex items-center gap-2 h-9">
              <input
                id="include-planner-checkbox"
                type="checkbox"
                checked={includePlanner}
                onChange={(e) => setIncludePlanner(e.currentTarget.checked)}
                disabled={pending}
                className="h-4 w-4 rounded border-input bg-background text-primary focus:ring-primary focus:ring-offset-2"
              />
              <Label htmlFor="include-planner-checkbox" className="text-xs text-muted-foreground cursor-pointer select-none">
                목표 및 일정 포함 (Include goals)
              </Label>
            </div>

            <Label className="text-xs uppercase text-muted-foreground tracking-wider">
              Git
            </Label>
            <div className="flex items-center gap-2 h-9">
              <input
                id="include-git-checkbox"
                type="checkbox"
                checked={includeGit}
                onChange={(e) => setIncludeGit(e.currentTarget.checked)}
                disabled={pending || contextProjectId == null}
                className="h-4 w-4 rounded border-input bg-background text-primary focus:ring-primary focus:ring-offset-2 disabled:opacity-40"
              />
              <Label
                htmlFor="include-git-checkbox"
                className="text-xs text-muted-foreground cursor-pointer select-none"
                title="Prepend branch + recent commits to the system prompt"
              >
                최근 커밋 포함 (Include git log)
              </Label>
            </div>
          </div>

          {contextProject && (
            <p className="text-[11px] text-muted-foreground">
              Each message will fetch top-{settings.ragTopK} relevant chunks from{" "}
              <span className="font-mono">{contextProject.name}</span> and prepend
              them as a system prompt.
            </p>
          )}

          <div
            ref={scrollRef}
            className="h-96 overflow-y-auto rounded-xl border border-border/50 bg-background p-4 space-y-6 text-sm shadow-inner"
          >
            {messages.length === 0 && !pending && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-60">
                <span className="text-3xl mb-2">✦</span>
                <p>대화를 시작해 보세요</p>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex flex-col space-y-1 ${m.role === "user" ? "items-end" : "items-start"}`}
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
                  {m.role}
                </div>
                <div
                  className={`px-4 py-3 rounded-2xl max-w-[85%] ${m.role === "user" ? "bg-primary/10 text-foreground rounded-tr-sm" : "bg-muted/30 text-foreground rounded-tl-sm border border-border/50"}`}
                >
                  {m.role === "assistant" ? (
                    m.content ? (
                      (() => {
                        const { cleanText, action } = extractPlannerAction(m.content);
                        const isStreaming = pending && i === messages.length - 1;
                        return (
                          <div className="space-y-1 max-w-none">
                            <div className="prose prose-sm">
                              <Markdown>{cleanText}</Markdown>
                            </div>
                            {action && !isStreaming && (
                              <ActionProposalCard
                                action={action}
                                conversationId={currentConvId}
                                messageIndex={i}
                                projectId={contextProjectId}
                                onApplied={() => window.dispatchEvent(new CustomEvent("refresh-planner"))}
                              />
                            )}

                          </div>
                        );
                      })()
                    ) : pending && i === messages.length - 1 ? (
                      <div className="text-muted-foreground italic flex items-center gap-2">
                        <span className="animate-pulse">●</span>
                        <span className="animate-pulse delay-75">●</span>
                        <span className="animate-pulse delay-150">●</span>
                      </div>
                    ) : null
                  ) : (
                    <>
                      <div className="whitespace-pre-wrap leading-relaxed">
                        {m.content}
                      </div>
                      {chunksByTurn[i] && chunksByTurn[i].length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <ContextBadge chunks={chunksByTurn[i]} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="메시지를 입력하세요 (⌘/Ctrl + Enter 전송)"
              rows={3}
              className="resize-none rounded-xl bg-background border-border/50 focus-visible:ring-primary shadow-sm p-3 text-xs"
              disabled={pending || optimizing}
            />

            <div className="flex gap-2 w-full">
              <Button
                type="button"
                onClick={handleOptimizePrompt}
                disabled={!input.trim() || pending || optimizing}
                className="flex-1 border border-border bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground rounded-xl h-9 font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {optimizing ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>최적화 중...</span>
                  </>
                ) : (
                  <>
                    <span>🪄</span>
                    <span>번역 및 프롬프트 최적화 (Optimize)</span>
                  </>
                )}
              </Button>

              <Button
                onClick={send}
                disabled={!input.trim() || pending || optimizing}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl h-9 font-semibold text-[11px] flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              >
                {pending ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>생각 중...</span>
                  </>
                ) : (
                  <span>전송 (Send)</span>
                )}
              </Button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-destructive whitespace-pre-wrap font-mono mt-1">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------- Sidebar ----------------

type Bucket = "Today" | "Yesterday" | "Earlier";

function bucketize(conversations: Conversation[]): Array<[Bucket, Conversation[]]> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const startOfYesterday = startOfToday - 86400;

  const out: Record<Bucket, Conversation[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const c of conversations) {
    const t = c.last_message_at ?? c.updated_at;
    if (t >= startOfToday) out.Today.push(c);
    else if (t >= startOfYesterday) out.Yesterday.push(c);
    else out.Earlier.push(c);
  }
  return (["Today", "Yesterday", "Earlier"] as Bucket[])
    .filter((b) => out[b].length > 0)
    .map((b) => [b, out[b]]);
}

function ConversationSidebar({
  conversations,
  currentConvId,
  onSelect,
  onRename,
  onDelete,
}: {
  conversations: Conversation[];
  currentConvId: number | null;
  onSelect: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
}) {
  const groups = bucketize(conversations);

  return (
    <aside className="flex flex-col gap-3 border-r border-border/50 pr-4 min-h-[28rem]">
      <div className="overflow-y-auto flex-1 space-y-4 -mr-2 pr-2">
        {groups.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-6 leading-relaxed">
            아직 저장된 대화가 없습니다.
            <br />
            메시지를 보내면 여기에 표시돼요.
          </p>
        )}
        {groups.map(([bucket, items]) => (
          <div key={bucket}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1 mb-1">
              {bucket}
            </div>
            <ul className="space-y-0.5">
              {items.map((c) => (
                <ConversationItem
                  key={c.id}
                  conv={c}
                  active={c.id === currentConvId}
                  onSelect={() => onSelect(c.id)}
                  onRename={(t) => onRename(c.id, t)}
                  onDelete={() => onDelete(c.id)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ConversationItem({
  conv,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);

  function commit() {
    setEditing(false);
    if (draft !== conv.title) onRename(draft);
  }

  if (editing) {
    return (
      <li>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft(conv.title);
              setEditing(false);
            }
          }}
          className="h-7 text-xs px-2"
        />
      </li>
    );
  }

  return (
    <li
      className={`group flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer text-xs ${
        active ? "bg-primary/10 text-foreground" : "hover:bg-muted/40 text-muted-foreground hover:text-foreground"
      }`}
      onClick={onSelect}
      title={conv.title}
    >
      <span className="truncate flex-1">{conv.title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(conv.title);
          setEditing(true);
        }}
        className="opacity-0 group-hover:opacity-100 hover:text-primary px-1 transition-opacity"
        title="이름 변경"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 hover:text-destructive px-1 transition-opacity"
        title="삭제"
      >
        ✕
      </button>
    </li>
  );
}

function ContextBadge({ chunks }: { chunks: ChunkSearchResult[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="text-[11px] mt-1"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        🔎 context: {chunks.length} chunk{chunks.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-1 space-y-1">
        {chunks.map((c) => (
          <li
            key={c.chunk_id}
            className="rounded border bg-background/60 p-1.5 font-mono"
          >
            <div className="truncate text-muted-foreground">
              {c.file_path}:{c.start_line}–{c.end_line}{" "}
              <span className="opacity-60">
                · d={c.distance?.toFixed(3) ?? "—"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
