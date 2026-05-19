import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/Markdown";
import {
  commands,
  type ChatEvent,
  type ChunkSearchResult,
  type Message,
  type Project,
} from "@/lib/bindings";

const PROVIDERS = ["anthropic", "gemini", "openai"] as const;
type Provider = (typeof PROVIDERS)[number];

const FALLBACK_MODEL: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
};

const CONTEXT_TOP_K = 5;

function buildContextSystem(chunks: ChunkSearchResult[]): string {
  const blocks = chunks
    .map(
      (c) =>
        `### \`${c.file_path}\` (lines ${c.start_line}–${c.end_line})\n\`\`\`\n${c.content}\n\`\`\``,
    )
    .join("\n\n");
  return [
    "You have access to the user's codebase. The most relevant snippets for the current question are below.",
    "When you reference code, cite the file path and line range.",
    "",
    blocks,
  ].join("\n");
}

export function ChatPanel() {
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [contextProjectId, setContextProjectId] = useState<number | null>(null);
  const [chunksByTurn, setChunksByTurn] = useState<Record<number, ChunkSearchResult[]>>(
    {},
  );

  useEffect(() => {
    (async () => {
      const saved = await commands.settingsGet("default_model");
      if (saved.status === "ok" && saved.data) setModel(saved.data);

      const ps = await commands.listProjects();
      if (ps.status === "ok") setProjects(ps.data);
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  async function send() {
    const text = input.trim();
    if (!text || pending) return;

    const userMsg: Message = { role: "user", content: text };
    const placeholder: Message = { role: "assistant", content: "" };
    const baseHistory = [...messages, userMsg];
    const userIndex = baseHistory.length - 1;

    setMessages([...baseHistory, placeholder]);
    setInput("");
    setPending(true);
    setError(null);

    // RAG: if a context project is selected, fetch top-K chunks for this turn
    // and prepend them as a system prompt before calling the LLM.
    let llmHistory = baseHistory;
    let chunks: ChunkSearchResult[] = [];
    if (contextProjectId != null) {
      const res = await commands.searchChunks(contextProjectId, text, CONTEXT_TOP_K);
      if (res.status === "ok" && res.data.length > 0) {
        chunks = res.data;
        llmHistory = [
          { role: "system", content: buildContextSystem(chunks) },
          ...baseHistory,
        ];
      } else if (res.status === "error") {
        setError(`Context search failed: ${res.error}`);
      }
    }
    setChunksByTurn((prev) => ({ ...prev, [userIndex]: chunks }));

    const channel = new Channel<ChatEvent>();
    channel.onmessage = (event) => {
      if (event.kind === "delta") {
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

    const res = await commands.chatStream(
      provider,
      llmHistory,
      {
        model: model || FALLBACK_MODEL[provider],
        temperature: null,
        max_tokens: null,
      },
      channel,
    );

    if (res.status === "error") {
      setError(res.error);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.content === "") {
          return prev.slice(0, -1);
        }
        return prev;
      });
    }
    setPending(false);
  }

  function reset() {
    setMessages([]);
    setChunksByTurn({});
    setError(null);
  }

  const contextProject = projects.find((p) => p.id === contextProjectId);

  return (
    <section className="w-full max-w-md rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Chat</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={!messages.length || pending}
        >
          Clear
        </Button>
      </div>

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
          placeholder={FALLBACK_MODEL[provider]}
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
      </div>

      {contextProject && (
        <p className="text-[11px] text-muted-foreground">
          Each message will fetch top-{CONTEXT_TOP_K} relevant chunks from{" "}
          <span className="font-mono">{contextProject.name}</span> and prepend
          them as a system prompt.
        </p>
      )}

      <div
        ref={scrollRef}
        className="h-80 overflow-y-auto rounded-md border bg-muted/30 p-3 space-y-3 text-sm"
      >
        {messages.length === 0 && !pending && (
          <p className="text-muted-foreground text-center pt-20">
            대화를 시작해 보세요
          </p>
        )}

        {messages.map((m, i) => (
          <div key={i} className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {m.role}
            </div>
            {m.role === "assistant" ? (
              m.content ? (
                <Markdown>{m.content}</Markdown>
              ) : pending && i === messages.length - 1 ? (
                <div className="text-muted-foreground italic">생각 중…</div>
              ) : null
            ) : (
              <>
                <div className="whitespace-pre-wrap leading-relaxed">
                  {m.content}
                </div>
                {chunksByTurn[i] && chunksByTurn[i].length > 0 && (
                  <ContextBadge chunks={chunksByTurn[i]} />
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <Textarea
        value={input}
        onChange={(e) => setInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="메시지를 입력하세요  (⌘/Ctrl + Enter 전송)"
        rows={3}
        className="resize-none"
        disabled={pending}
      />

      <Button
        onClick={send}
        disabled={!input.trim() || pending}
        className="w-full"
      >
        {pending ? "Streaming…" : "Send"}
      </Button>

      {error && (
        <p className="text-xs text-destructive whitespace-pre-wrap font-mono">
          {error}
        </p>
      )}
    </section>
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
