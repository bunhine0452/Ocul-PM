import { useEffect, useRef, useState } from "react";
import { commands } from "@/lib/bindings";
import { PROVIDERS, type Provider } from "@/lib/settings";

// Provider-specific well-known models — used as dropdown suggestions.
// Users can always type a custom model name.
const KNOWN_MODELS: Record<Provider, string[]> = {
  anthropic: [
    "claude-sonnet-4-6",
    "claude-opus-4-7",
    "claude-3.5-haiku-latest",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-4-turbo"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  nim: [
    "meta/llama-3.3-70b-instruct",
    "nvidia/llama-3.1-nemotron-70b-instruct",
  ],
};

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  nim: "NIM",
};

function secretName(provider: Provider): string {
  return `${provider}_api_key`;
}

interface ModelSelectorProps {
  provider: Provider;
  model: string;
  onProviderChange: (p: Provider) => void;
  onModelChange: (m: string) => void;
  disabled?: boolean;
  /** Placeholder shown when model is empty */
  placeholder?: string;
}

export function ModelSelector({
  provider,
  model,
  onProviderChange,
  onModelChange,
  disabled = false,
  placeholder,
}: ModelSelectorProps) {
  const [hasKey, setHasKey] = useState<Record<Provider, boolean | null>>({
    anthropic: null,
    openai: null,
    gemini: null,
    nim: null,
  });

  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const providerRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  // Check API key presence for all providers on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of PROVIDERS) {
        const res = await commands.secretHas(secretName(p));
        if (cancelled) return;
        if (res.status === "ok") {
          setHasKey((prev) => ({ ...prev, [p]: res.data }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close dropdowns on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        providerRef.current &&
        !providerRef.current.contains(e.target as Node)
      ) {
        setProviderOpen(false);
      }
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const keyStatus = hasKey[provider];
  const statusDot =
    keyStatus === true
      ? "bg-emerald-500"
      : keyStatus === false
        ? "bg-amber-500"
        : "bg-muted-foreground/40";

  return (
    <div className="flex items-center gap-0 h-7 text-[11px] font-medium w-full min-w-0">
      {/* Provider dropdown */}
      <div className="relative shrink-0" ref={providerRef}>
        <button
          onClick={() => !disabled && setProviderOpen((o) => !o)}
          disabled={disabled}
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-l-lg border border-border bg-secondary/40 hover:bg-secondary/70 text-foreground transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          <span>{PROVIDER_LABELS[provider]}</span>
          <svg
            className="w-2.5 h-2.5 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {providerOpen && (
          <div className="absolute left-0 top-full mt-1 z-50 w-44 bg-card border border-border rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100">
            {PROVIDERS.map((p) => {
              const pHasKey = hasKey[p];
              return (
                <button
                  key={p}
                  onClick={() => {
                    onProviderChange(p);
                    setProviderOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors cursor-pointer ${
                    p === provider
                      ? "bg-primary/10 text-primary font-semibold"
                      : "hover:bg-accent/50 text-foreground"
                  } ${pHasKey === false ? "opacity-50" : ""}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      pHasKey === true
                        ? "bg-emerald-500"
                        : pHasKey === false
                          ? "bg-amber-500"
                          : "bg-muted-foreground/40"
                    }`}
                  />
                  <span className="flex-1">{PROVIDER_LABELS[p]}</span>
                  {pHasKey === false && (
                    <span className="text-[9px] text-muted-foreground">
                      No Key
                    </span>
                  )}
                  {p === provider && (
                    <span className="text-primary text-xs">✓</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Model dropdown + input */}
      <div className="relative flex-1 min-w-0" ref={modelRef}>
        <div className="flex items-center h-7 border border-l-0 border-border rounded-r-lg bg-background overflow-hidden">
          <input
            type="text"
            value={model}
            onChange={(e) => onModelChange(e.currentTarget.value)}
            placeholder={placeholder ?? KNOWN_MODELS[provider][0]}
            disabled={disabled}
            className="flex-1 min-w-0 h-full px-2 text-[11px] font-mono bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={() => !disabled && setModelOpen((o) => !o)}
            disabled={disabled}
            className="shrink-0 px-1.5 h-full hover:bg-accent/50 text-muted-foreground transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <svg
              className="w-2.5 h-2.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>

        {modelOpen && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100 max-h-48 overflow-y-auto">
            {KNOWN_MODELS[provider].map((m) => (
              <button
                key={m}
                onClick={() => {
                  onModelChange(m);
                  setModelOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono transition-colors cursor-pointer ${
                  m === model
                    ? "bg-primary/10 text-primary font-semibold"
                    : "hover:bg-accent/50 text-foreground"
                }`}
              >
                <span className="flex-1 truncate">{m}</span>
                {m === model && (
                  <span className="text-primary text-xs">✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
