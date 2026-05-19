import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/Markdown";
import { commands, type ChatEvent, type Message } from "@/lib/bindings";

const PROVIDERS = ["anthropic", "gemini", "openai"] as const;
type Provider = (typeof PROVIDERS)[number];

const FALLBACK_MODEL: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
};

export function ChatPanel() {
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const saved = await commands.settingsGet("default_model");
      if (saved.status === "ok" && saved.data) {
        setModel(saved.data);
      }
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

    setMessages([...baseHistory, placeholder]);
    setInput("");
    setPending(true);
    setError(null);

    const channel = new Channel<ChatEvent>();
    channel.onmessage = (event) => {
      if (event.kind === "delta") {
        setMessages((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              content: last.content + event.text,
            };
          }
          return next;
        });
      } else if (event.kind === "error") {
        setError(event.message);
      }
      // 'done' is handled via the awaited result below.
    };

    const res = await commands.chatStream(
      provider,
      baseHistory,
      {
        model: model || FALLBACK_MODEL[provider],
        temperature: null,
        max_tokens: null,
      },
      channel,
    );

    if (res.status === "error") {
      setError(res.error);
      // Remove the empty placeholder if nothing came back.
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
    setError(null);
  }

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
        />
      </div>

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
              <div className="whitespace-pre-wrap leading-relaxed">
                {m.content}
              </div>
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
