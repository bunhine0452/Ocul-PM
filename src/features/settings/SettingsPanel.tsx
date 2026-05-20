import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commands, type GithubVerifyResult } from "@/lib/bindings";
import {
  Sun,
  Moon,
  Monitor,
  KeyRound,
  Sparkles,
  Database,
  GitBranch,
  Settings as SettingsIcon,
  FileCode,
  Save,
  Trash2,
  Copy,
  RefreshCw,
} from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { PROVIDERS, type Provider } from "@/lib/settings";

type TabId = "appearance" | "llm" | "github" | "indexing" | "graph" | "data";

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "appearance", label: "Appearance", icon: Sun },
  { id: "llm", label: "LLM", icon: Sparkles },
  { id: "github", label: "GitHub", icon: GitBranch },
  { id: "indexing", label: "Indexing & RAG", icon: FileCode },
  { id: "graph", label: "Graph", icon: GitBranch },
  { id: "data", label: "Data", icon: Database },
];

const GITHUB_SECRET = "github_api_key";

function secretName(provider: Provider): string {
  return `${provider}_api_key`;
}

// ---------- Reusable bits ----------

function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 py-5 first:pt-0 border-b border-border/60 last:border-b-0 last:pb-0">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase text-muted-foreground tracking-wider">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-background hover:bg-accent/30 transition-colors cursor-pointer"
    >
      <span className="text-sm text-foreground">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function NumberSlider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[color:var(--primary)]"
      />
      <span className="text-xs text-foreground font-mono tabular-nums w-12 text-right">
        {value}
      </span>
    </div>
  );
}

// ---------- Tabs ----------

function AppearanceTab() {
  const { settings, set } = useSettings();
  return (
    <>
      <Section title="Theme" description="Light, dark, or follow your OS preference.">
        <div className="grid grid-cols-3 gap-3">
          {(["light", "dark", "system"] as const).map((t) => {
            const isActive = settings.theme === t;
            return (
              <button
                key={t}
                onClick={() => set("theme", t)}
                className={`flex flex-col items-center justify-center p-3.5 rounded-xl border text-xs font-semibold gap-2 transition-all cursor-pointer ${
                  isActive
                    ? "bg-primary/10 border-primary text-primary shadow-sm"
                    : "bg-background border-border hover:border-primary/45 hover:bg-accent/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "light" && <Sun className="w-4 h-4" />}
                {t === "dark" && <Moon className="w-4 h-4" />}
                {t === "system" && <Monitor className="w-4 h-4" />}
                <span className="capitalize">{t}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Code Editor" description="Font and layout for the in-app code editor.">
        <Field label="Font family" hint="Falls back to system monospace if the named font isn't found.">
          <Input
            value={settings.editorFontFamily}
            onChange={(e) => set("editorFontFamily", e.currentTarget.value)}
            placeholder="D2Coding"
          />
        </Field>

        <Field label={`Font size — ${settings.editorFontSize}px`}>
          <NumberSlider
            value={settings.editorFontSize}
            min={10}
            max={22}
            onChange={(v) => set("editorFontSize", v)}
          />
        </Field>

        <Field label={`Tab width — ${settings.editorTabWidth} spaces`}>
          <NumberSlider
            value={settings.editorTabWidth}
            min={1}
            max={8}
            onChange={(v) => set("editorTabWidth", v)}
          />
        </Field>

        <Toggle
          checked={settings.editorShowLineNumbers}
          onChange={(v) => set("editorShowLineNumbers", v)}
          label="Show line numbers"
        />
        <Toggle
          checked={settings.editorActiveLineHighlight}
          onChange={(v) => set("editorActiveLineHighlight", v)}
          label="Highlight active line"
        />
        <Toggle
          checked={settings.editorIndentGuides}
          onChange={(v) => set("editorIndentGuides", v)}
          label="Show indent guides"
        />
        <Toggle
          checked={settings.editorWordWrap}
          onChange={(v) => set("editorWordWrap", v)}
          label="Word wrap"
        />
      </Section>
    </>
  );
}

function LlmTab({ onError }: { onError: (msg: string | null) => void }) {
  const { settings, set } = useSettings();
  const [provider, setProvider] = useState<Provider>(settings.defaultProvider);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState<Record<Provider, boolean | null>>({
    anthropic: null,
    openai: null,
    gemini: null,
  });
  const [verifying, setVerifying] = useState(false);

  // Cached presence check — does NOT unlock the keychain.
  const refreshKeyStatus = async (p: Provider) => {
    const res = await commands.secretHas(secretName(p));
    if (res.status === "ok") {
      setHasKey((prev) => ({ ...prev, [p]: res.data }));
      onError(null);
    } else {
      onError(res.error);
    }
  };

  useEffect(() => {
    for (const p of PROVIDERS) refreshKeyStatus(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveKey = async () => {
    if (!apiKey) return;
    const res = await commands.secretSet(secretName(provider), apiKey);
    if (res.status === "ok") {
      setApiKey("");
      await refreshKeyStatus(provider);
    } else {
      onError(res.error);
    }
  };

  const clearKey = async () => {
    const res = await commands.secretDelete(secretName(provider));
    if (res.status === "ok") {
      await refreshKeyStatus(provider);
    } else {
      onError(res.error);
    }
  };

  // Force a real keychain read for every provider — prompts the user once.
  const verifyAll = async () => {
    setVerifying(true);
    try {
      for (const p of PROVIDERS) {
        const res = await commands.secretVerify(secretName(p));
        if (res.status === "ok") {
          setHasKey((prev) => ({ ...prev, [p]: res.data }));
        } else {
          onError(res.error);
        }
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <Section title="API Keys" description="Stored securely in your OS keychain.">
        <select
          value={provider}
          onChange={(e) => setProvider(e.currentTarget.value as Provider)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p} {hasKey[p] === true ? "  ✓ key saved" : hasKey[p] === false ? "  ✗ not set" : ""}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <KeyRound className="w-3.5 h-3.5" />
          <span>
            {hasKey[provider] === null
              ? "Checking…"
              : hasKey[provider]
              ? "Saved in keychain"
              : "No key set for this provider"}
          </span>
        </div>

        <Input
          type="password"
          placeholder="Paste API key…"
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />

        <div className="flex gap-2">
          <Button
            onClick={saveKey}
            disabled={!apiKey}
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save
          </Button>
          <Button
            onClick={clearKey}
            disabled={!hasKey[provider]}
            variant="outline"
            className="flex-1"
          >
            Clear
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 text-[11px] text-muted-foreground">
          <span>
            Status is cached locally — opening this panel does not prompt your keychain.
          </span>
          <button
            onClick={verifyAll}
            disabled={verifying}
            className="shrink-0 text-primary hover:underline disabled:opacity-50 cursor-pointer"
            title="Re-check the OS keychain (will prompt you)"
          >
            {verifying ? "Verifying…" : "Verify against keychain"}
          </button>
        </div>
      </Section>

      <Section title="Default Provider" description="Which provider chat and assist will use by default.">
        <div className="grid grid-cols-3 gap-3">
          {PROVIDERS.map((p) => {
            const isActive = settings.defaultProvider === p;
            return (
              <button
                key={p}
                onClick={() => set("defaultProvider", p)}
                className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all cursor-pointer capitalize ${
                  isActive
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-background border-border hover:border-primary/45 text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Models" description="Per-provider model overrides. Leave blank to use the built-in default.">
        <Field label="Anthropic">
          <Input
            placeholder="claude-sonnet-4-6"
            value={settings.modelAnthropic}
            onChange={(e) => set("modelAnthropic", e.currentTarget.value)}
          />
        </Field>
        <Field label="OpenAI">
          <Input
            placeholder="gpt-4o-mini"
            value={settings.modelOpenai}
            onChange={(e) => set("modelOpenai", e.currentTarget.value)}
          />
        </Field>
        <Field label="Gemini">
          <Input
            placeholder="gemini-2.5-flash"
            value={settings.modelGemini}
            onChange={(e) => set("modelGemini", e.currentTarget.value)}
          />
        </Field>
        <Field label="Fallback default model">
          <Input
            placeholder="claude-opus-4-7"
            value={settings.defaultModel}
            onChange={(e) => set("defaultModel", e.currentTarget.value)}
          />
        </Field>
      </Section>

      <Section title="Generation" description="How the model responds.">
        <Field label={`Temperature — ${settings.temperature.toFixed(2)}`} hint="Lower is more focused, higher more creative.">
          <NumberSlider
            value={settings.temperature}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set("temperature", v)}
          />
        </Field>
        <Field label={`Max output tokens — ${settings.maxTokens}`}>
          <NumberSlider
            value={settings.maxTokens}
            min={256}
            max={32768}
            step={256}
            onChange={(v) => set("maxTokens", v)}
          />
        </Field>
        <Field label="System prompt" hint="Prepended to every chat. Leave blank for the app default.">
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => set("systemPrompt", e.currentTarget.value)}
            placeholder="You are a helpful coding assistant…"
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
          />
        </Field>
        <Toggle
          checked={settings.streamResponses}
          onChange={(v) => set("streamResponses", v)}
          label="Stream responses"
        />
      </Section>
    </>
  );
}

function GithubTab({ onError }: { onError: (msg: string | null) => void }) {
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<GithubVerifyResult | null>(null);

  const refresh = async () => {
    const res = await commands.secretHas(GITHUB_SECRET);
    if (res.status === "ok") setHasToken(res.data);
  };

  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    if (!token) return;
    const res = await commands.secretSet(GITHUB_SECRET, token);
    if (res.status === "ok") {
      setToken("");
      setVerified(null);
      await refresh();
      onError(null);
    } else {
      onError(res.error);
    }
  };

  const clear = async () => {
    const res = await commands.secretDelete(GITHUB_SECRET);
    if (res.status === "ok") {
      setVerified(null);
      await refresh();
      onError(null);
    } else {
      onError(res.error);
    }
  };

  const verify = async () => {
    setVerifying(true);
    onError(null);
    const res = await commands.githubVerify();
    setVerifying(false);
    if (res.status === "ok") {
      setVerified(res.data);
    } else {
      setVerified(null);
      onError(res.error);
    }
  };

  return (
    <>
      <Section
        title="Personal Access Token"
        description="Used to read repo metadata, PRs, issues, etc. Stored in your OS keychain."
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <KeyRound className="w-3.5 h-3.5" />
          <span>
            {hasToken === null
              ? "Checking…"
              : hasToken
              ? "Token saved in keychain"
              : "No token saved"}
          </span>
        </div>

        <Input
          type="password"
          placeholder="ghp_… or github_pat_…"
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
        />

        <div className="flex gap-2">
          <Button
            onClick={save}
            disabled={!token}
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save
          </Button>
          <Button
            onClick={clear}
            disabled={!hasToken}
            variant="outline"
            className="flex-1"
          >
            Clear
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 text-[11px] text-muted-foreground">
          <span>
            Recommended scopes: <code className="font-mono">read:user</code>,{" "}
            <code className="font-mono">repo</code> (for private repos).{" "}
            <a
              href="https://github.com/settings/tokens?type=beta"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Create one →
            </a>
          </span>
          <button
            onClick={verify}
            disabled={!hasToken || verifying}
            className="shrink-0 text-primary hover:underline disabled:opacity-50 cursor-pointer"
          >
            {verifying ? "Verifying…" : "Verify token"}
          </button>
        </div>
      </Section>

      {verified && (
        <Section title="Connected as">
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background">
            {verified.user.avatar_url && (
              <img
                src={verified.user.avatar_url}
                alt={verified.user.login}
                className="w-10 h-10 rounded-full border border-border"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {verified.user.name || verified.user.login}
              </div>
              <a
                href={verified.user.html_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-primary hover:underline font-mono"
              >
                @{verified.user.login}
              </a>
            </div>
            <div className="text-right text-[11px] text-muted-foreground font-mono">
              <div>
                {verified.rate_limit.remaining}/{verified.rate_limit.limit}
              </div>
              <div>API calls left</div>
            </div>
          </div>
        </Section>
      )}

      <Section
        title="Local git"
        description="Git log and remotes are read from the project folder using the local git CLI — no token required."
      >
        <p className="text-[11px] text-muted-foreground/80">
          A token is only needed when you want to fetch GitHub-specific data
          (PRs, issues, GraphQL queries, write actions).
        </p>
      </Section>
    </>
  );
}

function IndexingTab() {
  const { settings, set } = useSettings();
  return (
    <>
      <Section
        title="Chunking"
        description="Larger chunks preserve more context per snippet; smaller chunks improve search precision."
      >
        <Field label={`Chunk size — ${settings.chunkSize} lines`}>
          <NumberSlider
            value={settings.chunkSize}
            min={5}
            max={120}
            onChange={(v) => set("chunkSize", v)}
          />
        </Field>
        <Field label={`Chunk overlap — ${settings.chunkOverlap} lines`} hint="How much consecutive chunks share. Must be less than chunk size.">
          <NumberSlider
            value={settings.chunkOverlap}
            min={0}
            max={Math.max(0, settings.chunkSize - 1)}
            onChange={(v) => set("chunkOverlap", v)}
          />
        </Field>
      </Section>

      <Section title="Retrieval" description="How many chunks to feed the model as context for each chat message.">
        <Field label={`RAG context — top ${settings.ragTopK} chunks`}>
          <NumberSlider
            value={settings.ragTopK}
            min={0}
            max={20}
            onChange={(v) => set("ragTopK", v)}
          />
        </Field>
      </Section>

      <Section title="File scanning" description="Controls which files are walked and indexed.">
        <Field label={`Max file size — ${settings.maxFileSizeKb} KB`} hint="Files larger than this are skipped entirely.">
          <NumberSlider
            value={settings.maxFileSizeKb}
            min={50}
            max={4096}
            step={50}
            onChange={(v) => set("maxFileSizeKb", v)}
          />
        </Field>
        <Field
          label="Additional exclude patterns"
          hint="One gitignore-style pattern per line. Applied on top of .gitignore. Example: dist/**, *.snap"
        >
          <textarea
            value={settings.excludePatterns}
            onChange={(e) => set("excludePatterns", e.currentTarget.value)}
            placeholder={"dist/**\n*.test.ts\nfixtures/**"}
            rows={5}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
          />
        </Field>
        <p className="text-[11px] text-muted-foreground/80 italic">
          Changes apply the next time you re-index a project.
        </p>
      </Section>
    </>
  );
}

function GraphTab() {
  const { settings, set } = useSettings();
  return (
    <Section title="Dependency graph defaults">
      <Toggle
        checked={settings.graphShowIsolated}
        onChange={(v) => set("graphShowIsolated", v)}
        label="Show isolated files by default"
      />
      <Field
        label={`Auto-group threshold — ${settings.graphGroupThreshold} files`}
        hint="Directories with at least this many files become collapsible groups inside a column."
      >
        <NumberSlider
          value={settings.graphGroupThreshold}
          min={2}
          max={12}
          onChange={(v) => set("graphGroupThreshold", v)}
        />
      </Field>
    </Section>
  );
}

function DataTab({ onError }: { onError: (msg: string | null) => void }) {
  const { resetAll } = useSettings();
  const [info, setInfo] = useState<{ db_path: string; app_data_dir: string; secrets_store: string; version: string } | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    commands.appInfo().then((res) => {
      if (res.status === "ok") setInfo(res.data);
    });
  }, []);

  const copy = (s: string, label: string) => {
    navigator.clipboard.writeText(s);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  };

  const handleClear = async () => {
    if (busy) return;
    setBusy(true);
    const res = await commands.clearAllData();
    setBusy(false);
    setConfirmingClear(false);
    if (res.status === "error") onError(res.error);
    else onError(null);
  };

  const openDevtools = async () => {
    const res = await commands.openDevtools();
    if (res.status === "error") onError(res.error);
  };

  const resetSettings = async () => {
    await resetAll();
  };

  return (
    <>
      <Section title="Storage" description="Where this app stores its data.">
        {info ? (
          <div className="space-y-2 text-xs font-mono">
            {(
              [
                ["Database", info.db_path],
                ["App data", info.app_data_dir],
                ["Secrets", info.secrets_store],
                ["Version", info.version],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-background border border-border"
              >
                <div className="overflow-hidden">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {k}
                  </div>
                  <div className="truncate text-foreground" title={v}>
                    {v}
                  </div>
                </div>
                <button
                  onClick={() => copy(v, k)}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 cursor-pointer"
                  title={copied === k ? "Copied!" : "Copy"}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
      </Section>

      <Section title="Diagnostics">
        <Button variant="outline" onClick={openDevtools} className="w-full">
          Open DevTools
        </Button>
      </Section>

      <Section
        title="Reset"
        description="Restore every setting to its default value. API keys and indexed projects are kept."
      >
        <Button variant="outline" onClick={resetSettings} className="w-full">
          <RefreshCw className="w-3.5 h-3.5 mr-2" />
          Reset settings to defaults
        </Button>
      </Section>

      <Section
        title="Danger zone"
        description="Deletes every project, index, conversation, setting, and saved API key on this machine."
      >
        {!confirmingClear ? (
          <Button
            variant="outline"
            onClick={() => setConfirmingClear(true)}
            className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Clear all data
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-destructive font-medium">
              This cannot be undone. Are you absolutely sure?
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleClear}
                disabled={busy}
                className="flex-1 bg-destructive text-white hover:bg-destructive/90"
              >
                {busy ? "Clearing…" : "Yes, delete everything"}
              </Button>
              <Button
                onClick={() => setConfirmingClear(false)}
                variant="outline"
                disabled={busy}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

// ---------- Root ----------

interface SettingsPanelProps {
  /** When true, render flush with the surrounding page (no card chrome, no
   *  duplicate "Settings" heading). Use this inside a workspace that already
   *  provides its own page header. Defaults to false (modal/standalone). */
  embedded?: boolean;
}

export function SettingsPanel({ embedded = false }: SettingsPanelProps) {
  const [tab, setTab] = useState<TabId>("appearance");
  const [error, setError] = useState<string | null>(null);
  const { loaded } = useSettings();

  const activeTab = useMemo(() => {
    switch (tab) {
      case "appearance":
        return <AppearanceTab />;
      case "llm":
        return <LlmTab onError={setError} />;
      case "github":
        return <GithubTab onError={setError} />;
      case "indexing":
        return <IndexingTab />;
      case "graph":
        return <GraphTab />;
      case "data":
        return <DataTab onError={setError} />;
    }
  }, [tab]);

  if (!loaded) {
    return (
      <div className={embedded ? "" : "w-full max-w-4xl rounded-xl border bg-card p-6 shadow-sm"}>
        <span className="text-sm text-muted-foreground">Loading settings…</span>
      </div>
    );
  }

  const body = (
    <div className="flex">
      {/* Tab nav */}
      <nav
        className={`w-48 flex-shrink-0 ${
          embedded ? "" : "border-r border-border/60 bg-background/40"
        } p-2 space-y-0.5`}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Tab content */}
      <div
        className={`flex-1 ${
          embedded ? "px-6 pt-2 pb-6" : "p-6 overflow-y-auto max-h-[70vh] scrollbar-thin"
        }`}
      >
        {activeTab}
        {error && (
          <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-xs hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) {
    return <div className="w-full">{body}</div>;
  }

  return (
    <section className="w-full max-w-4xl rounded-xl border bg-card shadow-sm overflow-hidden">
      <header className="px-6 py-4 border-b border-border/60 flex items-center gap-2">
        <SettingsIcon className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-heading font-semibold">Settings</h2>
      </header>
      {body}
    </section>
  );
}

// Re-export helper for callers that previously imported the Save icon path
// from this module (kept for compatibility).
export { Save };
