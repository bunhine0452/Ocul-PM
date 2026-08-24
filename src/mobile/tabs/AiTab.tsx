// 모바일 AI — /api/chat SSE 스트리밍 (#mb4-chat-sse).
//
// 프로바이더·모델·폴백은 맥의 설정(SQLite)을 settings_get 으로 읽어 데스크톱과
// 같은 순수 헬퍼(providerModel·parseFallbacks)로 계산한다. API 키는 서버
// (키체인)에만 있다 — 폰은 프롬프트만 보낸다. 대화는 "Mobile" 대화로 영속
// (데스크톱 AI 패널에서도 보인다).
import { useCallback, useEffect, useRef, useState } from "react";

import { commands, type Role } from "@/lib/bindings";
import { useT } from "@/i18n";
import {
  entriesToSettings,
  KEYS,
  parseFallbacks,
  providerModel,
  type Provider,
  type Settings,
} from "@/lib/settings";
import { authHeaders } from "@/lib/transport/http";
import { SseParser } from "@/lib/transport/sse";

const CONV_TITLE = "Mobile";
const LLM_KEYS = [
  KEYS.defaultProvider,
  KEYS.defaultModel,
  KEYS.modelAnthropic,
  KEYS.modelOpenai,
  KEYS.modelGemini,
  KEYS.modelNim,
  KEYS.modelOpenrouter,
  KEYS.fallbackModels,
  KEYS.temperature,
  KEYS.maxTokens,
  KEYS.systemPrompt,
] as const;

interface Bubble {
  role: Role;
  content: string;
}

type ChatEventJson =
  | { kind: "delta"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function AiTab({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [convId, setConvId] = useState<number | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 설정(LLM 서브셋) + 기존 Mobile 대화 복원.
  const boot = useCallback(async () => {
    const entries: Array<[string, string]> = [];
    await Promise.all(
      LLM_KEYS.map(async (key) => {
        const res = await commands.settingsGet(key);
        if (res.status === "ok" && res.data !== null) entries.push([key, res.data]);
      }),
    );
    setSettings(entriesToSettings(entries));

    const convs = await commands.conversationList(projectId);
    if (convs.status !== "ok") return;
    const mine = convs.data.find((c) => c.title === CONV_TITLE);
    if (!mine) return;
    setConvId(mine.id);
    const msgs = await commands.chatMessageList(mine.id);
    if (msgs.status === "ok") {
      setBubbles(msgs.data.map((m) => ({ role: m.role as Role, content: m.content })));
    }
  }, [projectId]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" }); // jsdom 미구현 가드
  }, [bubbles]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming || !settings) return;
    const provider = settings.defaultProvider as Provider;
    const model = providerModel(settings, provider);

    setError(null);
    setInput("");
    setStreaming(true);
    const history: Bubble[] = [...bubbles, { role: "user", content: text }];
    setBubbles([...history, { role: "assistant", content: "" }]);

    // 대화 확보 + 사용자 메시지 영속 (실패해도 스트리밍은 계속 — 편의 기능).
    let cid = convId;
    if (cid === null) {
      const created = await commands.conversationCreate(CONV_TITLE, provider, model, projectId);
      if (created.status === "ok") {
        cid = created.data.id;
        setConvId(cid);
      }
    }
    if (cid !== null) {
      void commands.chatMessageAppend(cid, "user", text, provider, model);
    }

    const messages = [
      ...(settings.systemPrompt.trim()
        ? [{ role: "system" as Role, content: settings.systemPrompt }]
        : []),
      ...history.map((b) => ({ role: b.role, content: b.content })),
    ];

    let acc = "";
    const setLast = (content: string) =>
      setBubbles((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content };
        return next;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          provider,
          messages,
          options: {
            model,
            temperature: settings.temperature,
            max_tokens: settings.maxTokens,
          },
          fallbacks: parseFallbacks(settings),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          if (frame.event !== "chat" || !frame.data) continue;
          const event = JSON.parse(frame.data) as ChatEventJson;
          if (event.kind === "delta") {
            acc += event.text;
            setLast(acc);
          } else if (event.kind === "error") {
            setError(event.message);
          }
        }
      }
      if (acc && cid !== null) {
        void commands.chatMessageAppend(cid, "assistant", acc, provider, model);
      }
      if (!acc) {
        // 델타가 하나도 없었다 — 빈 말풍선을 걷는다.
        setBubbles((prev) => prev.slice(0, -1));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBubbles((prev) => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {bubbles.length === 0 ? (
          <p className="text-sm mob-text-3 text-center py-8">{t("mobile.ai.empty")}</p>
        ) : (
          bubbles.map((b, i) => (
            <div
              key={i}
              className={`max-w-[85%] px-3.5 py-2 text-[14px] whitespace-pre-wrap leading-relaxed ${
                b.role === "user" ? "mob-bubble-user ml-auto" : "mob-bubble-ai mr-auto"
              }`}
            >
              {b.content || "…"}
            </div>
          ))
        )}
        {error ? (
          <p className="text-xs mob-danger whitespace-pre-wrap">
            {t("mobile.ai.failed", { message: error })}
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <div className="p-3 flex gap-2" style={{ borderTop: "1px solid var(--sep)" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={t("mobile.ai.placeholder")}
          className="mob-input flex-1 px-3.5 py-2.5 text-sm"
        />
        <button
          onClick={() => void send()}
          disabled={!input.trim() || streaming}
          className="mob-btn-primary px-4 text-sm"
        >
          {t("mobile.ai.send")}
        </button>
      </div>
    </div>
  );
}
