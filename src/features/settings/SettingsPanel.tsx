import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commands } from "@/lib/bindings";

const PROVIDERS = ["openai", "anthropic", "gemini"] as const;
type Provider = (typeof PROVIDERS)[number];

const DEFAULT_MODEL_KEY = "default_model";

function secretName(provider: Provider): string {
  return `${provider}_api_key`;
}

export function SettingsPanel() {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  const [defaultModel, setDefaultModel] = useState("");
  const [savedModel, setSavedModel] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  async function refreshKeyStatus(p: Provider) {
    const res = await commands.secretHas(secretName(p));
    if (res.status === "ok") {
      setHasKey(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
  }

  async function refreshDefaultModel() {
    const res = await commands.settingsGet(DEFAULT_MODEL_KEY);
    if (res.status === "ok") {
      setSavedModel(res.data);
    } else {
      setError(res.error);
    }
  }

  useEffect(() => {
    refreshKeyStatus(provider);
  }, [provider]);

  useEffect(() => {
    refreshDefaultModel();
  }, []);

  async function saveKey() {
    if (!apiKey) return;
    const res = await commands.secretSet(secretName(provider), apiKey);
    if (res.status === "ok") {
      setApiKey("");
      await refreshKeyStatus(provider);
    } else {
      setError(res.error);
    }
  }

  async function clearKey() {
    const res = await commands.secretDelete(secretName(provider));
    if (res.status === "ok") {
      await refreshKeyStatus(provider);
    } else {
      setError(res.error);
    }
  }

  async function saveModel() {
    if (!defaultModel) return;
    const res = await commands.settingsSet(DEFAULT_MODEL_KEY, defaultModel);
    if (res.status === "ok") {
      setDefaultModel("");
      await refreshDefaultModel();
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="w-full max-w-md rounded-lg border bg-card p-6 space-y-6">
      <h2 className="text-lg font-semibold">Settings</h2>

      {/* API Key (keychain) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase text-muted-foreground tracking-wider">
            LLM API Key
          </Label>
          <span className="text-xs">
            {hasKey === null
              ? "…"
              : hasKey
              ? "✓ Saved in Keychain"
              : "✗ Not set"}
          </span>
        </div>

        <select
          value={provider}
          onChange={(e) => setProvider(e.currentTarget.value as Provider)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <Input
          type="password"
          placeholder="Paste API key…"
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />

        <div className="flex gap-2">
          <Button onClick={saveKey} disabled={!apiKey} className="flex-1">
            Save
          </Button>
          <Button
            onClick={clearKey}
            disabled={!hasKey}
            variant="outline"
            className="flex-1"
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="border-t" />

      {/* Default model (DB settings) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase text-muted-foreground tracking-wider">
            Default Model
          </Label>
          <span className="text-xs text-muted-foreground font-mono">
            {savedModel ?? "—"}
          </span>
        </div>

        <Input
          placeholder="e.g. claude-opus-4-7"
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.currentTarget.value)}
        />

        <Button onClick={saveModel} disabled={!defaultModel} className="w-full">
          Save Model
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">Error: {error}</p>}
    </section>
  );
}
