import { useEffect, useMemo, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commands, type DbHealth, type GithubVerifyResult, type IndexProgress } from "@/lib/bindings";
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
  Download,
} from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/lib/toast";
import { PROVIDERS, type Provider, type Theme } from "@/lib/settings";
import { useUpdater, releaseHighlights } from "@/lib/updater";
import { Markdown } from "@/components/Markdown";
import { OculpmSettings } from "./OculpmSettings";

type TabId =
  | "appearance"
  | "llm"
  | "github"
  | "indexing"
  | "graph"
  | "data"
  | "oculpm"
  | "diagnostics"
  | "update";

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "appearance", label: "모양", icon: Sun },
  { id: "llm", label: "LLM", icon: Sparkles },
  { id: "github", label: "GitHub", icon: GitBranch },
  { id: "indexing", label: "인덱싱 & RAG", icon: FileCode },
  { id: "graph", label: "그래프", icon: GitBranch },
  { id: "data", label: "데이터", icon: Database },
  { id: "oculpm", label: "ocul-pm", icon: FileCode },
  // Diagnostics absorbed from the old separate sidebar tab (MASTER-GUIDE §5.1).
  { id: "diagnostics", label: "진단", icon: SettingsIcon },
  // Update surfaced out of the buried 데이터 section into its own tab below 진단.
  { id: "update", label: "업데이트", icon: Download },
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

// Preset themes shown in 모양 → 테마. Each `id` is a `Theme` value the
// SettingsContext turns into `data-preset` over a light/dark base family. The
// swatch colors mirror the palette in tokens.css / App.css so the picker shows a
// faithful mini-preview without loading the theme.
const THEME_PRESETS: Array<{
  id: Theme;
  label: string;
  bg: string;
  fg: string;
  accent: string;
  accent2: string;
}> = [
  { id: "solarized", label: "Solarized", bg: "#fdf6e3", fg: "#586e75", accent: "#268bd2", accent2: "#859900" },
  { id: "nord", label: "Nord", bg: "#2e3440", fg: "#eceff4", accent: "#88c0d0", accent2: "#81a1c1" },
  { id: "dracula", label: "Dracula", bg: "#282a36", fg: "#f8f8f2", accent: "#bd93f9", accent2: "#ff79c6" },
  { id: "sepia", label: "Sepia", bg: "#f4ecd8", fg: "#4a3a2a", accent: "#b06a2c", accent2: "#8a6a3a" },
  { id: "high-contrast", label: "High Contrast", bg: "#000000", fg: "#ffffff", accent: "#ffd400", accent2: "#ffffff" },
];

function AppearanceTab() {
  const { settings, set } = useSettings();
  return (
    <>
      <Section
        title="외부 에디터"
        description="외부 에디터로 열기 (⌘B → 파일 선택 → 외부 에디터). %path 는 절대 파일 경로로 치환됩니다."
      >
        <Field
          label="명령 템플릿"
          hint='기본값: code "%path". Cursor 는 cursor "%path", Sublime 은 subl "%path". macOS GUI 앱은 셸 PATH 를 상속받지 않으므로 PATH 에 없으면 절대 경로를 적어 주세요 (예: /usr/local/bin/code "%path").'
        >
          <Input
            value={settings.externalEditorCommand}
            onChange={(e) => set("externalEditorCommand", e.currentTarget.value)}
            placeholder='code "%path"'
            className="font-mono"
          />
        </Field>
      </Section>

      <Section title="테마" description="밝게 / 어둡게 · OS 설정 · 또는 프리셋 테마를 선택합니다.">
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

        <div className="mt-1">
          <Label className="text-[11px] uppercase text-muted-foreground tracking-wider">
            프리셋 테마
          </Label>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {THEME_PRESETS.map((p) => {
              const isActive = settings.theme === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => set("theme", p.id)}
                  className={`flex flex-col items-stretch gap-2 p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isActive
                      ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                      : "border-border hover:border-primary/45 bg-background"
                  }`}
                >
                  <span
                    className="flex items-center gap-1.5 h-9 px-2 rounded-md border"
                    style={{ background: p.bg, borderColor: "rgba(127,127,127,0.25)" }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: p.accent }} />
                    <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: p.accent2 }} />
                    <span className="flex-1 h-1.5 rounded-full" style={{ background: p.fg, opacity: 0.4 }} />
                  </span>
                  <span
                    className={`text-xs font-semibold text-center ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section
        title="글자 크기"
        description="앱 전체 글자와 화면 배율을 조절합니다 — 브라우저 확대/축소처럼 동작합니다."
      >
        <Field label={`배율 — ${Math.round(settings.uiScale * 100)}%`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={70}
              max={160}
              step={5}
              value={Math.round(settings.uiScale * 100)}
              onChange={(e) => set("uiScale", Number(e.target.value) / 100)}
              className="flex-1 accent-[color:var(--primary)]"
            />
            <span className="text-xs text-foreground font-mono tabular-nums w-12 text-right">
              {Math.round(settings.uiScale * 100)}%
            </span>
          </div>
        </Field>
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ["작게", 0.9],
              ["기본", 1],
              ["크게", 1.1],
              ["더 크게", 1.25],
            ] as const
          ).map(([label, v]) => {
            const isActive = Math.abs(settings.uiScale - v) < 0.001;
            return (
              <button
                key={label}
                onClick={() => set("uiScale", v)}
                className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-background border-border hover:border-primary/45 text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="코드 에디터" description="앱 내 코드 에디터의 글꼴과 레이아웃 (※ Lite-W6 PR5 에서 코드 에디터는 legacy 로 이동 — 이 설정은 1.1 까지 보존).">
        <Field label="글꼴" hint="지정한 글꼴이 없으면 시스템 모노스페이스로 대체됩니다.">
          <Input
            value={settings.editorFontFamily}
            onChange={(e) => set("editorFontFamily", e.currentTarget.value)}
            placeholder="D2Coding"
          />
        </Field>

        <Field label={`글꼴 크기 — ${settings.editorFontSize}px`}>
          <NumberSlider
            value={settings.editorFontSize}
            min={10}
            max={22}
            onChange={(v) => set("editorFontSize", v)}
          />
        </Field>

        <Field label={`탭 너비 — ${settings.editorTabWidth} spaces`}>
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
          label="줄 번호 표시"
        />
        <Toggle
          checked={settings.editorActiveLineHighlight}
          onChange={(v) => set("editorActiveLineHighlight", v)}
          label="활성 줄 강조"
        />
        <Toggle
          checked={settings.editorIndentGuides}
          onChange={(v) => set("editorIndentGuides", v)}
          label="들여쓰기 가이드 표시"
        />
        <Toggle
          checked={settings.editorWordWrap}
          onChange={(v) => set("editorWordWrap", v)}
          label="줄 바꿈"
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
    nim: null,
    openrouter: null,
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
      <Section title="API 키" description="OS 키체인에 안전하게 저장됩니다.">
        <select
          value={provider}
          onChange={(e) => setProvider(e.currentTarget.value as Provider)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p} {hasKey[p] === true ? "  ✓ 저장됨" : hasKey[p] === false ? "  ✗ 미설정" : ""}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <KeyRound className="w-3.5 h-3.5" />
          <span>
            {hasKey[provider] === null
              ? "확인 중…"
              : hasKey[provider]
              ? "키체인에 저장됨"
              : "이 프로바이더에 키 없음"}
          </span>
        </div>

        <Input
          type="password"
          placeholder="API 키 붙여넣기…"
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />

        <div className="flex gap-2">
          <Button
            onClick={saveKey}
            disabled={!apiKey}
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            저장
          </Button>
          <Button
            onClick={clearKey}
            disabled={!hasKey[provider]}
            variant="outline"
            className="flex-1"
          >
            삭제
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 text-[11px] text-muted-foreground">
          <span>
            상태는 로컬에 캐시됩니다 — 이 패널을 열어도 키체인 프롬프트가 뜨지 않습니다.
          </span>
          <button
            onClick={verifyAll}
            disabled={verifying}
            className="shrink-0 text-primary hover:underline disabled:opacity-50 cursor-pointer"
            title="OS 키체인 재확인 (프롬프트가 뜹니다)"
          >
            {verifying ? "확인 중…" : "키체인 대조 확인"}
          </button>
        </div>
      </Section>

      <Section title="기본 프로바이더" description="채팅과 지원에 기본으로 사용할 프로바이더.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

      <Section title="모델" description="프로바이더별 모델 오버라이드. 비우면 내장 기본값을 사용합니다.">
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
        <Field label="NVIDIA NIM" hint="integrate.api.nvidia.com 의 OpenAI 호환 엔드포인트.">
          <Input
            placeholder="meta/llama-3.3-70b-instruct"
            value={settings.modelNim}
            onChange={(e) => set("modelNim", e.currentTarget.value)}
          />
        </Field>
        <Field label="OpenRouter" hint="openrouter.ai — 수백 개 모델을 OpenAI 호환으로. 모델 id 예: openai/gpt-4o.">
          <Input
            placeholder="openai/gpt-4o-mini"
            value={settings.modelOpenrouter}
            onChange={(e) => set("modelOpenrouter", e.currentTarget.value)}
          />
        </Field>
        <Field label="폴백 기본 모델">
          <Input
            placeholder="claude-opus-4-7"
            value={settings.defaultModel}
            onChange={(e) => set("defaultModel", e.currentTarget.value)}
          />
        </Field>
      </Section>

      <Section
        title="폴백 체인"
        description="기본 모델 호출이 실패하면 아래 모델을 위에서부터 차례로 재시도합니다. 한 줄에 하나씩 `provider:model` 형식."
      >
        <Field label="순서대로 재시도" hint="예) openai:gpt-4o-mini · anthropic:claude-3.5-haiku-latest · openrouter:openai/gpt-4o">
          <textarea
            value={settings.fallbackModels}
            onChange={(e) => set("fallbackModels", e.currentTarget.value)}
            placeholder={"openai:gpt-4o-mini\nanthropic:claude-3.5-haiku-latest"}
            rows={3}
            spellCheck={false}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
          />
        </Field>
      </Section>

      <Section title="생성" description="모델 응답 방식.">
        <Field label={`Temperature — ${settings.temperature.toFixed(2)}`} hint="낮을수록 집중, 높을수록 창의적.">
          <NumberSlider
            value={settings.temperature}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set("temperature", v)}
          />
        </Field>
        <Field label={`최대 출력 토큰 — ${settings.maxTokens}`}>
          <NumberSlider
            value={settings.maxTokens}
            min={256}
            max={32768}
            step={256}
            onChange={(v) => set("maxTokens", v)}
          />
        </Field>
        <Field label="시스템 프롬프트" hint="모든 채팅 앞에 추가됩니다. 비우면 앱 기본값을 사용합니다.">
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => set("systemPrompt", e.currentTarget.value)}
            placeholder="당신은 도움이 되는 코딩 어시스턴트입니다…"
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
          />
        </Field>
        <Toggle
          checked={settings.streamResponses}
          onChange={(v) => set("streamResponses", v)}
          label="응답 스트리밍"
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
        title="개인 액세스 토큰 (Personal Access Token)"
        description="저장소 메타데이터 · PR · 이슈 등을 읽는 데 사용됩니다. OS 키체인에 저장됩니다."
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <KeyRound className="w-3.5 h-3.5" />
          <span>
            {hasToken === null
              ? "확인 중…"
              : hasToken
              ? "토큰이 키체인에 저장됨"
              : "저장된 토큰 없음"}
          </span>
        </div>

        <Input
          type="password"
          placeholder="ghp_… 또는 github_pat_…"
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
        />

        <div className="flex gap-2">
          <Button
            onClick={save}
            disabled={!token}
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            저장
          </Button>
          <Button
            onClick={clear}
            disabled={!hasToken}
            variant="outline"
            className="flex-1"
          >
            삭제
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 text-[11px] text-muted-foreground">
          <span>
            권장 scope: <code className="font-mono">read:user</code>,{" "}
            <code className="font-mono">repo</code> (private 저장소 시).{" "}
            <a
              href="https://github.com/settings/tokens?type=beta"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              토큰 만들기 →
            </a>
          </span>
          <button
            onClick={verify}
            disabled={!hasToken || verifying}
            className="shrink-0 text-primary hover:underline disabled:opacity-50 cursor-pointer"
          >
            {verifying ? "확인 중…" : "토큰 확인"}
          </button>
        </div>
      </Section>

      {verified && (
        <Section title="연결된 계정">
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
              <div>남은 API 호출</div>
            </div>
          </div>
        </Section>
      )}

      <Section
        title="로컬 git"
        description="로컬 git CLI 로 프로젝트 폴더의 git 로그와 remote 를 읽습니다 — 토큰 불필요."
      >
        <p className="text-[11px] text-muted-foreground/80">
          토큰은 GitHub 전용 데이터 (PR, 이슈, GraphQL 쿼리, write action) 를
          가져올 때만 필요합니다.
        </p>
      </Section>
    </>
  );
}

function IndexingTab() {
  const { settings, set } = useSettings();
  const { state } = useWorkspace();
  const projectId = state.currentProjectId;
  const [reindexing, setReindexing] = useState(false);

  const reindex = async () => {
    if (projectId == null || reindexing) return;
    setReindexing(true);
    const channel = new Channel<IndexProgress>();
    const res = await commands.indexProject(projectId, channel);
    setReindexing(false);
    if (res.status === "ok") toast.info("코드 검색 인덱스를 다시 만들었어요.");
    else toast.destructive(`인덱스 재구축 실패: ${res.error}`);
  };

  return (
    <>
      <Section
        title="자동 인덱싱 · 재구축"
        description="파일이 바뀌면 워처가 바뀐 파일만 곧바로 인덱싱합니다(이미 인덱싱된 프로젝트). 직접 처음부터 다시 만들려면 재구축하세요."
      >
        <Toggle
          checked={settings.autoIndex}
          onChange={(v) => set("autoIndex", v)}
          label="변경 시 자동 인덱싱"
        />
        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={reindex}
            disabled={projectId == null || reindexing}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reindexing ? "animate-spin" : ""}`} />
            {reindexing ? "재구축 중…" : "인덱스 재구축"}
          </Button>
          {projectId == null ? (
            <span className="text-[11px] text-muted-foreground">프로젝트를 선택하면 재구축할 수 있어요.</span>
          ) : null}
        </div>
      </Section>

      <Section
        title="청킹"
        description="청크가 클수록 스니펫당 컨텍스트가 풍부하고, 작을수록 검색 정밀도가 높아집니다."
      >
        <Field label={`청크 크기 — ${settings.chunkSize} 줄`}>
          <NumberSlider
            value={settings.chunkSize}
            min={5}
            max={120}
            onChange={(v) => set("chunkSize", v)}
          />
        </Field>
        <Field label={`청크 오버랩 — ${settings.chunkOverlap} 줄`} hint="연속된 청크가 공유하는 양. 청크 크기보다 작아야 합니다.">
          <NumberSlider
            value={settings.chunkOverlap}
            min={0}
            max={Math.max(0, settings.chunkSize - 1)}
            onChange={(v) => set("chunkOverlap", v)}
          />
        </Field>
      </Section>

      <Section title="검색 (Retrieval)" description="채팅 메시지마다 모델에 컨텍스트로 전달할 청크 수.">
        <Field label={`RAG 컨텍스트 — 상위 ${settings.ragTopK} 청크`}>
          <NumberSlider
            value={settings.ragTopK}
            min={0}
            max={20}
            onChange={(v) => set("ragTopK", v)}
          />
        </Field>
      </Section>

      <Section
        title="AI 작업 맥락 (ocul-pm)"
        description="최근 작업일지와 AGENTS 규칙을 채팅 컨텍스트에 자동으로 넣어, 세션·모델이 바뀌어도 작업 방향을 유지합니다."
      >
        <Toggle
          checked={settings.includeOculpmContext}
          onChange={(v) => set("includeOculpmContext", v)}
          label="작업일지 · 규칙 자동 주입"
        />
        {settings.includeOculpmContext && (
          <Field
            label={`주입할 최근 일지 — ${settings.oculpmContextEntries}개`}
            hint="많을수록 맥락이 풍부하지만 토큰 사용량이 늘어납니다. 0이면 규칙만 주입합니다."
          >
            <NumberSlider
              value={settings.oculpmContextEntries}
              min={0}
              max={15}
              onChange={(v) => set("oculpmContextEntries", v)}
            />
          </Field>
        )}
      </Section>

      <Section title="파일 스캔" description="어떤 파일을 탐색·인덱싱할지 제어합니다.">
        <Field label={`최대 파일 크기 — ${settings.maxFileSizeKb} KB`} hint="이보다 큰 파일은 전체가 스킵됩니다.">
          <NumberSlider
            value={settings.maxFileSizeKb}
            min={50}
            max={4096}
            step={50}
            onChange={(v) => set("maxFileSizeKb", v)}
          />
        </Field>
        <Field
          label="추가 제외 패턴"
          hint="한 줄에 하나의 gitignore 스타일 패턴. .gitignore 위에 적용됩니다. 예: dist/**, *.snap"
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
          변경 사항은 다음 번 프로젝트 재인덱싱 때 적용됩니다.
        </p>
      </Section>
    </>
  );
}

function GraphTab() {
  const { settings, set } = useSettings();
  return (
    <Section title="의존성 그래프 기본값">
      <Toggle
        checked={settings.graphShowIsolated}
        onChange={(v) => set("graphShowIsolated", v)}
        label="기본으로 고립된 파일 표시"
      />
      <Field
        label={`자동 그룹 임계값 — ${settings.graphGroupThreshold} 파일`}
        hint="이 개수 이상의 파일을 가진 디렉토리는 컬럼 안에서 접을 수 있는 그룹이 됩니다."
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
      <Section title="저장소" description="이 앱이 데이터를 저장하는 위치.">
        {info ? (
          <div className="space-y-2 text-xs font-mono">
            {(
              [
                ["데이터베이스", info.db_path],
                ["앱 데이터", info.app_data_dir],
                ["비밀 데이터", info.secrets_store],
                ["버전", info.version],
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
                  title={copied === k ? "복사됨!" : "복사"}
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

      <Section title="진단">
        <Button variant="outline" onClick={openDevtools} className="w-full">
          DevTools 열기
        </Button>
      </Section>

      <Section
        title="초기화"
        description="모든 설정을 기본값으로 복원합니다. API 키와 인덱싱된 프로젝트는 유지됩니다."
      >
        <Button variant="outline" onClick={resetSettings} className="w-full">
          <RefreshCw className="w-3.5 h-3.5 mr-2" />
          설정 기본값으로 초기화
        </Button>
      </Section>

      <Section
        title="위험 구역"
        description="이 컴퓨터의 모든 프로젝트 · 인덱스 · 대화 · 설정 · 저장된 API 키를 삭제합니다."
      >
        {!confirmingClear ? (
          <Button
            variant="outline"
            onClick={() => setConfirmingClear(true)}
            className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            모든 데이터 삭제
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-destructive font-medium">
              이 작업은 되돌릴 수 없습니다. 정말로 삭제하시겠습니까?
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleClear}
                disabled={busy}
                className="flex-1 bg-destructive text-white hover:bg-destructive/90"
              >
                {busy ? "삭제 중…" : "예, 모두 삭제"}
              </Button>
              <Button
                onClick={() => setConfirmingClear(false)}
                variant="outline"
                disabled={busy}
                className="flex-1"
              >
                취소
              </Button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

// ---------- Diagnostics ----------

function DiagnosticsTab({ onError }: { onError: (msg: string | null) => void }) {
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    onError(null);
    const res = await commands.dbHealth();
    if (res.status === "ok") {
      setHealth(res.data);
    } else {
      onError(res.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Section
        title="데이터베이스 상태"
        description="SQLite + sqlite-vec 상태와 스키마 버전을 확인합니다."
      >
        <div className="grid grid-cols-3 gap-2">
          <Stat label="SQLite" value={health?.sqlite_version} />
          <Stat label="sqlite-vec" value={health?.vec_version} />
          <Stat label="스키마" value={health ? `v${health.schema_version}` : undefined} />
        </div>
        <div className="text-[11px] font-mono break-all text-muted-foreground">
          {health?.path ?? "조회되지 않음"}
        </div>
        <Button onClick={check} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          상태 새로고침
        </Button>
      </Section>
    </>
  );
}

// Repo behind the updater endpoint (tauri.conf.json) — used to fetch live patch
// notes (the latest release body == the installed version when up to date).
const RELEASES_API = "https://api.github.com/repos/bunhine0452/Ocul-PM/releases/latest";

function UpdateTab() {
  const { status: updater, check: checkUpdate, install: installUpdate } = useUpdater();
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [notesLoading, setNotesLoading] = useState(true);

  useEffect(() => {
    commands.appInfo().then((res) => {
      if (res.status === "ok") setVersion(res.data.version);
    });
    // Auto-check on open so the update state isn't hidden behind a manual click.
    void checkUpdate();
    // Live patch notes from the latest GitHub release (public repo, CORS-enabled;
    // offline / rate-limited just falls back to the empty-state message).
    fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setNotes(data?.body ? releaseHighlights(data.body) : null))
      .catch(() => setNotes(null))
      .finally(() => setNotesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Section
        title="업데이트"
        description="GitHub 릴리스에서 새 버전을 확인하고 앱 내에서 바로 설치합니다."
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            현재 버전{" "}
            <span className="font-mono text-foreground">v{version ?? "—"}</span>
          </div>
          {updater.kind === "available" ? (
            <Button
              onClick={() => void installUpdate()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Download className="w-3.5 h-3.5 mr-2" />
              v{updater.version} 설치 후 재시작
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => void checkUpdate()}
              disabled={updater.kind === "checking" || updater.kind === "installing"}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 mr-2 ${updater.kind === "checking" ? "animate-spin" : ""}`}
              />
              업데이트 확인
            </Button>
          )}
        </div>
        {updater.kind === "checking" && (
          <p className="text-[11px] text-muted-foreground">새 버전을 확인하는 중…</p>
        )}
        {updater.kind === "uptodate" && (
          <p className="text-[11px] text-primary">최신 버전을 사용 중입니다.</p>
        )}
        {updater.kind === "available" && (
          <p className="text-[11px] text-muted-foreground">
            새 버전 <span className="font-mono">v{updater.version}</span> 을 사용할 수 있어요.
          </p>
        )}
        {updater.kind === "installing" && (
          <p className="text-[11px] text-muted-foreground">
            다운로드 후 설치 중… 완료되면 앱이 자동으로 재시작됩니다.
          </p>
        )}
        {updater.kind === "error" && (
          <p className="text-[11px] text-destructive">
            업데이트를 확인하지 못했어요 (오프라인이거나 릴리스를 찾을 수 없음): {updater.message}
          </p>
        )}
      </Section>

      <Section title="패치노트" description="최근 릴리스의 변경 사항입니다.">
        {notesLoading ? (
          <span className="text-xs text-muted-foreground">불러오는 중…</span>
        ) : notes ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed [&_h3]:text-xs [&_h3]:font-semibold [&_ul]:my-1 [&_li]:my-0.5">
            <Markdown>{notes}</Markdown>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            패치노트를 불러오지 못했어요 (오프라인이거나 릴리스를 찾을 수 없음).
          </span>
        )}
      </Section>
    </>
  );
}

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div className="p-3 bg-secondary/40 rounded-xl">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold mt-0.5">{value ?? "—"}</div>
    </div>
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
      case "oculpm":
        return <OculpmSettings />;
      case "diagnostics":
        return <DiagnosticsTab onError={setError} />;
      case "update":
        return <UpdateTab />;
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
