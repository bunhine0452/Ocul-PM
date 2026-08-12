import { useEffect, useMemo, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commands, type DbHealth, type IndexProgress, type NotionStatus } from "@/lib/bindings";
import {
  Sun,
  Moon,
  Monitor,
  Languages,
  KeyRound,
  Sparkles,
  Database,
  GitBranch,
  Settings as SettingsIcon,
  FileCode,
  Trash2,
  Copy,
  RefreshCw,
  Download,
  Bug,
  MessageSquare,
  Loader2,
} from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/lib/toast";
import { PROVIDERS, type ColorTheme, type Provider, type Theme } from "@/lib/settings";
import { normalizeLangSetting, resolveLang, useT, type I18nKey, type LangSetting } from "@/i18n";
import { useUpdater, releaseHighlights } from "@/lib/updater";
import { Markdown } from "@/components/Markdown";
import { OculpmSettings } from "./OculpmSettings";

type TabId =
  | "appearance"
  | "llm"
  | "indexing"
  | "graph"
  | "data"
  | "oculpm"
  | "diagnostics"
  | "update";

const TABS: Array<{ id: TabId; labelKey: I18nKey; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "appearance", labelKey: "settings.tab.appearance", icon: Sun },
  { id: "llm", labelKey: "settings.tab.llm", icon: Sparkles },
  // GitHub PAT 탭은 감사(2026-07-16)에서 제거 — 소비처가 verify 뿐이라 vestigial
  // 이었고, 로컬 git 은 토큰 없이 동작한다 (git_log/status 는 git CLI).
  { id: "indexing", labelKey: "settings.tab.indexing", icon: FileCode },
  { id: "graph", labelKey: "settings.tab.graph", icon: GitBranch },
  { id: "data", labelKey: "settings.tab.data", icon: Database },
  { id: "oculpm", labelKey: "settings.tab.oculpm", icon: FileCode },
  // Diagnostics absorbed from the old separate sidebar tab (MASTER-GUIDE §5.1).
  { id: "diagnostics", labelKey: "settings.tab.diagnostics", icon: SettingsIcon },
  // Update surfaced out of the buried 데이터 section into its own tab below 진단.
  { id: "update", labelKey: "settings.tab.update", icon: Download },
];

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
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** 접근 가능한 이름. `Field` 의 <Label> 은 htmlFor 가 없어 연결되지 않는다 —
   *  axe "Form elements must have labels" 가 여기서 걸린다. */
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={ariaLabel}
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

/** 액센트 6색 스와치 — tokens.css [data-accent] 팔레트의 라이트 기준색 미리보기. */
const ACCENTS: Array<{ id: ColorTheme; labelKey: I18nKey; color: string }> = [
  { id: "green", labelKey: "settings.accent.green", color: "#0e8a60" },
  { id: "blue", labelKey: "settings.accent.blue", color: "#2570e0" },
  { id: "purple", labelKey: "settings.accent.purple", color: "#7c5cdb" },
  { id: "orange", labelKey: "settings.accent.orange", color: "#e07b12" },
  { id: "rose", labelKey: "settings.accent.rose", color: "#e0524b" },
  { id: "teal", labelKey: "settings.accent.teal", color: "#0e9aa0" },
];

function AccentPicker() {
  const { settings, set } = useSettings();
  const { t } = useT();
  // 프리셋 테마는 자기 액센트를 갖고 온다 (SettingsContext 가 data-accent 제거).
  const presetActive = !["light", "dark", "system"].includes(settings.theme);
  return (
    <div className="mt-2">
      <div className={`flex items-center gap-2 ${presetActive ? "opacity-40 pointer-events-none" : ""}`}>
        {ACCENTS.map((a) => {
          const on = settings.colorTheme === a.id;
          return (
            <button
              key={a.id}
              onClick={() => set("colorTheme", a.id)}
              title={t(a.labelKey)}
              aria-label={t("settings.accent.aria", { name: t(a.labelKey) })}
              aria-pressed={on}
              className={`h-7 w-7 rounded-full border-2 transition-all cursor-pointer ${
                on ? "border-foreground scale-110 shadow-sm" : "border-transparent hover:scale-105"
              }`}
              style={{ background: a.color }}
            />
          );
        })}
      </div>
      {presetActive ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground/80">
          {t("settings.accent.presetActive")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * UI 언어 (Phase 0 — docs/20260811_three-features/03-i18n.md).
 *
 * 라벨을 `t()` 로 뽑는 이유: 이 섹션 자체가 i18n 배선이 살아 있는지 보여주는
 * 첫 소비처다. 언어를 바꾸면 제목·힌트가 즉시 바뀌어야 하고, 그게 안 되면
 * `useT()` 구독이 끊긴 것이다.
 *
 * 언어 이름("한국어"/"English")은 양쪽 사전에서 **자기 언어 표기 그대로** 둔다 —
 * 영어 UI 에서 "Korean" 이라고 쓰면 한국어를 못 읽는 상태에서 자기 언어를 찾기가
 * 더 어렵다. OS 언어 선택 UI 들의 관례이기도 하다.
 */
/** 언어 3지선다 한 줄 — UI 언어와 AI 작성 언어가 같은 모양을 공유한다. */
function LangPicker({
  value,
  onPick,
}: {
  value: LangSetting;
  onPick: (v: LangSetting) => void;
}) {
  const { t } = useT();
  const options: Array<{ id: LangSetting; label: string }> = [
    { id: "system", label: t("settings.language.system") },
    { id: "ko", label: t("settings.language.ko") },
    { id: "en", label: t("settings.language.en") },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {options.map((o) => {
        const isActive = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            aria-pressed={isActive}
            className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
              isActive
                ? "bg-primary/10 border-primary text-primary shadow-sm"
                : "bg-background border-border hover:border-primary/45 hover:bg-accent/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.id === "system" ? <Monitor className="w-4 h-4" /> : <Languages className="w-4 h-4" />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 언어 설정 — **UI 언어와 AI 작성 언어를 분리**한다.
 *
 * 둘을 하나로 묶지 않은 이유는 되돌릴 수 있느냐가 다르기 때문이다. UI 언어는
 * 화면 텍스트만 바꾸고 언제든 되돌릴 수 있지만, AI 작성 언어는
 * `.oculpm/journal/*.md` 처럼 **디스크에 영구히 남는 문서**의 언어를 정한다.
 * UI 를 영어로 바꿨다는 이유만으로 일지가 조용히 영어로 넘어가면 언어가 섞인
 * 이력이 남고 되돌릴 방법이 없다.
 *
 * 그래서 UI 언어를 바꿔도 AI 작성 언어는 **따라가지 않고**, 맞출지 여부를
 * 액션 버튼 달린 토스트로 제안한다 (차단 모달이 아니라 — 되돌릴 수 있는
 * 조작마다 흐름을 막으면 설정을 만지기 싫어진다. AGENTS.md 업그레이드 제안과
 * 같은 관용구다).
 */
function LanguageSection() {
  const { settings, set } = useSettings();
  const { t } = useT();
  const uiLang = normalizeLangSetting(settings.language);
  const contentLang = normalizeLangSetting(settings.contentLanguage);

  const langLabel = (v: LangSetting) =>
    v === "ko"
      ? t("settings.language.ko")
      : v === "en"
        ? t("settings.language.en")
        : t("settings.language.system");

  const pickUiLang = (next: LangSetting) => {
    void set("language", next);
    // 해석된 언어가 실제로 갈라질 때만 제안한다 — 둘 다 "system" 이면 이미
    // 같은 언어라 물어볼 게 없다.
    if (resolveLang(next) === resolveLang(contentLang)) return;
    toast.warning(
      t("settings.language.syncToastBody", { target: langLabel(next) }),
      {
        title: t("settings.language.syncToast", { current: langLabel(contentLang) }),
        dedupKey: "content-language-sync",
        durationMs: 15000,
        actions: [
          {
            label: t("settings.language.syncAction", { target: langLabel(next) }),
            onClick: () => {
              void set("contentLanguage", next);
              toast.info(t("settings.language.syncDone", { target: langLabel(next) }));
            },
          },
        ],
      },
    );
  };

  return (
    <>
      <Section
        title={t("settings.language.uiTitle")}
        description={t("settings.language.uiHint")}
      >
        <LangPicker value={uiLang} onPick={pickUiLang} />
      </Section>

      <Section
        title={t("settings.language.contentTitle")}
        description={t("settings.language.contentHint")}
      >
        <LangPicker value={contentLang} onPick={(v) => void set("contentLanguage", v)} />
      </Section>
    </>
  );
}

function AppearanceTab() {
  const { t } = useT();
  const { settings, set } = useSettings();
  return (
    <>
      <LanguageSection />

      <Section
        title={t("settings.editor.title")}
        description={t("settings.editor.desc")}
      >
        <Field
          label={t("settings.editor.field")}
          hint={t("settings.editor.hint")}
        >
          <Input
            value={settings.externalEditorCommand}
            onChange={(e) => set("externalEditorCommand", e.currentTarget.value)}
            placeholder='code "%path"'
            className="font-mono"
          />
        </Field>
      </Section>

      <Section title={t("settings.theme.title")} description={t("settings.theme.desc")}>
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

        {/* 액센트 컬러 (감사 fix 2026-07-16) — colorTheme 인프라(data-accent)는
            v1.3.0 부터 살아있었지만 바꿀 UI 가 유실돼 있었다. 프리셋 테마는
            자기 액센트를 갖고 오므로(data-accent 제거) 그동안은 비활성. */}
        <div className="mt-1">
          <Label className="text-[11px] uppercase text-muted-foreground tracking-wider">
            {t("settings.accent.title")}
          </Label>
          <AccentPicker />
        </div>

        <div className="mt-1">
          <Label className="text-[11px] uppercase text-muted-foreground tracking-wider">
            {t("settings.theme.presets")}
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
        title={t("settings.scale.title")}
        description={t("settings.scale.desc")}
      >
        <Field label={t("settings.scale.field", { pct: Math.round(settings.uiScale * 100) })}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              aria-label={t("settings.scale.title")}
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
              ["settings.scale.small", 0.9],
              ["settings.scale.default", 1],
              ["settings.scale.large", 1.1],
              ["settings.scale.xlarge", 1.25],
            ] as const
          ).map(([labelKey, v]) => {
            const isActive = Math.abs(settings.uiScale - v) < 0.001;
            return (
              <button
                key={labelKey}
                onClick={() => set("uiScale", v)}
                className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-background border-border hover:border-primary/45 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </Section>

      <MenubarSection />
    </>
  );
}

/**
 * v2.3.0 메뉴바 상주 토글 3종 (docs/menubar/00-master-plan.md D4) — 전부 옵인,
 * 기본은 현행 동작. 키는 SQLite settings_* 직접 사용 (SettingsContext 의 정형
 * 키가 아니라 트레이 전용): tray.show_icon(기본 on) · tray.keep_running ·
 * tray.hide_dock(keep_running 이 켜져 있을 때만 의미).
 */
function MenubarSection() {
  const { t } = useT();
  const [vals, setVals] = useState<{
    show: boolean;
    keep: boolean;
    dock: boolean;
    notify: boolean;
  } | null>(null);

  useEffect(() => {
    void commands.settingsGetAll().then((res) => {
      if (res.status !== "ok") return;
      const m = new Map(res.data);
      setVals({
        show: m.get("tray.show_icon") !== "0",
        keep: m.get("tray.keep_running") === "1",
        dock: m.get("tray.hide_dock") === "1",
        notify: m.get("tray.notify_journal") === "1",
      });
    });
  }, []);

  const KEYS = {
    show: "tray.show_icon",
    keep: "tray.keep_running",
    dock: "tray.hide_dock",
    notify: "tray.notify_journal",
  } as const;

  const toggle = (key: keyof typeof KEYS) => {
    if (!vals) return;
    const next = { ...vals, [key]: !vals[key] };
    setVals(next);
    void commands
      .settingsSet(KEYS[key], next[key] ? "1" : "0")
      .then(() => commands.trayApplySettings());
  };

  const rows: Array<{ key: keyof typeof KEYS; label: string; hint: string; disabled?: boolean }> = [
    {
      key: "show",
      label: t("settings.tray.showIcon"),
      hint: t("settings.tray.showIconHint"),
    },
    {
      key: "keep",
      label: t("settings.tray.keepRunning"),
      hint: t("settings.tray.keepRunningHint"),
    },
    {
      key: "dock",
      label: t("settings.tray.hideDock"),
      hint: t("settings.tray.hideDockHint"),
      disabled: !vals?.keep,
    },
    {
      key: "notify",
      label: t("settings.tray.notify"),
      hint: t("settings.tray.notifyHint"),
    },
  ];

  return (
    <Section
      title={t("settings.tray.title")}
      description={t("settings.tray.desc")}
    >
      <div className="space-y-2">
        {rows.map((r) => (
          <button
            key={r.key}
            disabled={!vals || r.disabled}
            onClick={() => toggle(r.key)}
            className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
              vals?.[r.key] && !r.disabled
                ? "bg-primary/10 border-primary/60"
                : "bg-background border-border hover:border-primary/45"
            } ${r.disabled ? "opacity-45 cursor-default" : "cursor-pointer"}`}
          >
            <span
              className={`mt-0.5 w-8 h-4.5 rounded-full flex-none relative transition-colors ${
                vals?.[r.key] && !r.disabled ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            >
              <span
                className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${
                  vals?.[r.key] && !r.disabled ? "left-4" : "left-0.5"
                }`}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground">{r.label}</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                {r.hint}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function LlmTab({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
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
      <Section title={t("settings.keys.title")} description={t("settings.keys.desc")}>
        <select
          value={provider}
          onChange={(e) => setProvider(e.currentTarget.value as Provider)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p} {hasKey[p] === true ? t("settings.keys.saved") : hasKey[p] === false ? t("settings.keys.unset") : ""}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <KeyRound className="w-3.5 h-3.5" />
          <span>
            {hasKey[provider] === null
              ? t("settings.keys.checking")
              : hasKey[provider]
              ? t("settings.keys.inKeychain")
              : t("settings.keys.noKey")}
          </span>
        </div>

        <Input
          type="password"
          placeholder={t("settings.keys.placeholder")}
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />

        <div className="flex gap-2">
          <Button
            onClick={saveKey}
            disabled={!apiKey}
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t("common.save")}
          </Button>
          <Button
            onClick={clearKey}
            disabled={!hasKey[provider]}
            variant="outline"
            className="flex-1"
          >
            {t("common.delete")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 text-[11px] text-muted-foreground">
          <span>
            {t("settings.keys.cacheNote")}
          </span>
          <button
            onClick={verifyAll}
            disabled={verifying}
            className="shrink-0 text-primary hover:underline disabled:opacity-50 cursor-pointer"
            title={t("settings.keys.verifyTitle")}
          >
            {verifying ? t("settings.keys.checking") : t("settings.keys.verify")}
          </button>
        </div>
      </Section>

      <Section title={t("settings.provider.title")} description={t("settings.provider.desc")}>
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

      <Section title={t("settings.models.title")} description={t("settings.models.desc")}>
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
        <Field label="NVIDIA NIM" hint={t("settings.models.nimHint")}>
          <Input
            placeholder="meta/llama-3.3-70b-instruct"
            value={settings.modelNim}
            onChange={(e) => set("modelNim", e.currentTarget.value)}
          />
        </Field>
        <Field label="OpenRouter" hint={t("settings.models.openrouterHint")}>
          <Input
            placeholder="openai/gpt-4o-mini"
            value={settings.modelOpenrouter}
            onChange={(e) => set("modelOpenrouter", e.currentTarget.value)}
          />
        </Field>
        <Field label={t("settings.models.fallbackDefault")}>
          <Input
            placeholder="claude-opus-4-7"
            value={settings.defaultModel}
            onChange={(e) => set("defaultModel", e.currentTarget.value)}
          />
        </Field>
      </Section>

      <Section
        title={t("settings.fallback.title")}
        description={t("settings.fallback.desc")}
      >
        <Field label={t("settings.fallback.field")} hint={t("settings.fallback.hint")}>
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

      <Section title={t("settings.gen.title")} description={t("settings.gen.desc")}>
        <Field label={t("settings.gen.temperature", { value: settings.temperature.toFixed(2) })} hint={t("settings.gen.temperatureHint")}>
          <NumberSlider
            ariaLabel={t("settings.gen.temperature", { value: settings.temperature.toFixed(2) })}
            value={settings.temperature}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set("temperature", v)}
          />
        </Field>
        <Field label={t("settings.gen.maxTokens", { value: settings.maxTokens })}>
          <NumberSlider
            ariaLabel={t("settings.gen.maxTokens", { value: settings.maxTokens })}
            value={settings.maxTokens}
            min={256}
            max={32768}
            step={256}
            onChange={(v) => set("maxTokens", v)}
          />
        </Field>
        <Field label={t("settings.gen.systemPrompt")} hint={t("settings.gen.systemPromptHint")}>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => set("systemPrompt", e.currentTarget.value)}
            placeholder={t("settings.gen.systemPromptPlaceholder")}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y font-mono"
          />
        </Field>
      </Section>
    </>
  );
}

function IndexingTab() {
  const { t } = useT();
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
    if (res.status === "ok") toast.info(t("settings.index.reindexDone"));
    else toast.destructive(t("settings.index.reindexFailed", { error: res.error }));
  };

  return (
    <>
      <Section
        title={t("settings.index.title")}
        description={t("settings.index.desc")}
      >
        <Toggle
          checked={settings.autoIndex}
          onChange={(v) => set("autoIndex", v)}
          label={t("settings.index.auto")}
        />
        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={reindex}
            disabled={projectId == null || reindexing}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reindexing ? "animate-spin" : ""}`} />
            {reindexing ? t("settings.index.rebuilding") : t("settings.index.rebuild")}
          </Button>
          {projectId == null ? (
            <span className="text-[11px] text-muted-foreground">{t("settings.index.pickProject")}</span>
          ) : null}
        </div>
      </Section>

      <Section
        title={t("settings.chunk.title")}
        description={t("settings.chunk.desc")}
      >
        <Field label={t("settings.chunk.size", { n: settings.chunkSize })}>
          <NumberSlider
            ariaLabel={t("settings.chunk.size", { n: settings.chunkSize })}
            value={settings.chunkSize}
            min={5}
            max={120}
            onChange={(v) => set("chunkSize", v)}
          />
        </Field>
        <Field label={t("settings.chunk.overlap", { n: settings.chunkOverlap })} hint={t("settings.chunk.overlapHint")}>
          <NumberSlider
            ariaLabel={t("settings.chunk.overlap", { n: settings.chunkOverlap })}
            value={settings.chunkOverlap}
            min={0}
            max={Math.max(0, settings.chunkSize - 1)}
            onChange={(v) => set("chunkOverlap", v)}
          />
        </Field>
      </Section>

      <Section title={t("settings.retrieval.title")} description={t("settings.retrieval.desc")}>
        <Field label={t("settings.retrieval.topK", { n: settings.ragTopK })}>
          <NumberSlider
            ariaLabel={t("settings.retrieval.topK", { n: settings.ragTopK })}
            value={settings.ragTopK}
            min={0}
            max={20}
            onChange={(v) => set("ragTopK", v)}
          />
        </Field>
      </Section>

      <Section
        title={t("settings.aiContext.title")}
        description={t("settings.aiContext.desc")}
      >
        <Toggle
          checked={settings.includeOculpmContext}
          onChange={(v) => set("includeOculpmContext", v)}
          label={t("settings.aiContext.inject")}
        />
        {settings.includeOculpmContext && (
          <Field
            label={t("settings.aiContext.entries", { n: settings.oculpmContextEntries })}
            hint={t("settings.aiContext.entriesHint")}
          >
            <NumberSlider
              ariaLabel={t("settings.aiContext.entries", { n: settings.oculpmContextEntries })}
              value={settings.oculpmContextEntries}
              min={0}
              max={15}
              onChange={(v) => set("oculpmContextEntries", v)}
            />
          </Field>
        )}
      </Section>

      <Section title={t("settings.scan.title")} description={t("settings.scan.desc")}>
        <Field label={t("settings.scan.maxSize", { n: settings.maxFileSizeKb })} hint={t("settings.scan.maxSizeHint")}>
          <NumberSlider
            ariaLabel={t("settings.scan.maxSize", { n: settings.maxFileSizeKb })}
            value={settings.maxFileSizeKb}
            min={50}
            max={4096}
            step={50}
            onChange={(v) => set("maxFileSizeKb", v)}
          />
        </Field>
        <Field
          label={t("settings.scan.exclude")}
          hint={t("settings.scan.excludeHint")}
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
          {t("settings.scan.applyNote")}
        </p>
      </Section>
    </>
  );
}

function GraphTab() {
  const { t } = useT();
  const { settings, set } = useSettings();
  return (
    <Section title={t("settings.graph.title")}>
      <Toggle
        checked={settings.graphShowIsolated}
        onChange={(v) => set("graphShowIsolated", v)}
        label={t("settings.graph.showIsolated")}
      />
      <Field
        label={t("settings.graph.threshold", { n: settings.graphGroupThreshold })}
        hint={t("settings.graph.thresholdHint")}
      >
        <NumberSlider
          ariaLabel={t("settings.graph.threshold", { n: settings.graphGroupThreshold })}
          value={settings.graphGroupThreshold}
          min={2}
          max={12}
          onChange={(v) => set("graphGroupThreshold", v)}
        />
      </Field>
    </Section>
  );
}

/**
 * PR-CI7 (docs/claude-integration/00-master-plan.md D6) — Notion 내보내기 설정.
 * internal integration token 은 검증(users/me) 성공 후에만 기존 secret_set 으로
 * OS 키체인에 저장한다 (DB/localStorage 금지 규율 유지). 부모 페이지는 URL 을
 * 붙여넣으면 백엔드가 id 로 정규화해 SQLite settings 에 둔다. 내보내기 버튼
 * 자체는 회고 화면에 있고, 토큰이 없으면 그 버튼이 아예 노출되지 않는다.
 *
 * (export 는 테스트 전용 — notion_export_v2.test.tsx 가 SettingsContext 부트
 * 스트랩 없이 이 섹션만 단독 렌더한다.)
 */
export function NotionSection({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [token, setToken] = useState("");
  const [parent, setParent] = useState("");
  const [botName, setBotName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void commands.notionStatus().then((res) => {
      if (res.status === "ok") {
        setStatus(res.data);
        setParent(res.data.parent_page_id ?? "");
      }
    });
  };
  useEffect(refresh, []);

  const saveToken = async () => {
    // `t` 는 번역 함수 이름이라 지역 변수로 쓰지 않는다 (섀도잉).
    const trimmed = token.trim();
    if (busy || !trimmed) return;
    setBusy(true);
    try {
      const v = await commands.notionVerifyToken(trimmed);
      if (v.status === "error") {
        onError(t("settings.notion.tokenFailed", { error: v.error }));
        return;
      }
      const s = await commands.secretSet("notion_api_key", trimmed);
      if (s.status === "error") {
        onError(s.error);
        return;
      }
      setBotName(v.data);
      setToken("");
      onError(null);
      toast.info(t("settings.notion.linked", { name: v.data }));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  // #notion-oauth — "계정으로 연결": 브라우저 승인 → 서버리스 교환 → 루프백
  // 수신 → 키체인 저장까지 백엔드 한 커맨드. 최대 3분 대기.
  const connectOauth = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await commands.notionOauthStart();
      if (res.status === "ok") {
        setBotName(res.data);
        onError(null);
        toast.info(t("settings.notion.linked", { name: res.data }));
        refresh();
      } else {
        onError(t("settings.notion.linkFailed", { error: res.error }));
      }
    } finally {
      setBusy(false);
    }
  };

  const removeToken = async () => {
    if (busy) return;
    setBusy(true);
    const res = await commands.secretDelete("notion_api_key");
    setBusy(false);
    if (res.status === "error") {
      onError(res.error);
    } else {
      setBotName(null);
      toast.info(t("settings.notion.unlinked"));
      refresh();
    }
  };

  const saveParent = async () => {
    if (busy) return;
    setBusy(true);
    const res = await commands.notionSetParent(parent);
    setBusy(false);
    if (res.status === "error") {
      onError(res.error);
    } else {
      setParent(res.data ?? "");
      onError(null);
      toast.info(res.data ? t("settings.notion.parentSet") : t("settings.notion.parentCleared"));
      refresh();
    }
  };

  return (
    <Section
      title={t("settings.notion.title")}
      description={t("settings.notion.desc")}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void connectOauth()}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {t("settings.notion.connect")}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {t("settings.notion.connectHint")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("settings.notion.status")}</Label>
          {status?.has_token ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
              {t("settings.notion.connected")}{botName ? ` · ${botName}` : ""}
            </span>
          ) : (
            <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
              {t("settings.notion.disconnected")}
            </span>
          )}
          {status?.has_token && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void removeToken()}>
              {t("settings.notion.disconnect")}
            </Button>
          )}
        </div>

        {!status?.has_token && (
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="ntn_… (Notion internal integration token)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
            <Button size="sm" disabled={busy || !token.trim()} onClick={() => void saveToken()}>
              {busy ? t("settings.notion.verifying") : t("settings.notion.verifySave")}
            </Button>
          </div>
        )}

        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">
            {t("settings.notion.parent")}
          </Label>
          <div className="flex gap-2">
            <Input
              placeholder="https://www.notion.so/…"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveParent()}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

function DataTab({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
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
      <Section title={t("settings.storage.title")} description={t("settings.storage.desc")}>
        {info ? (
          <div className="space-y-2 text-xs font-mono">
            {(
              [
                ["settings.storage.db", info.db_path],
                ["settings.storage.appData", info.app_data_dir],
                ["settings.storage.secrets", info.secrets_store],
                ["settings.storage.version", info.version],
              ] as Array<[I18nKey, string]>
            ).map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-background border border-border"
              >
                <div className="overflow-hidden">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t(k)}
                  </div>
                  <div className="truncate text-foreground" title={v}>
                    {v}
                  </div>
                </div>
                <button
                  onClick={() => copy(v, k)}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 cursor-pointer"
                  title={copied === k ? t("settings.storage.copied") : t("common.copy")}
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

      <NotionSection onError={onError} />

      <Section title={t("settings.diag.title")}>
        <Button variant="outline" onClick={openDevtools} className="w-full">
          {t("settings.diag.devtools")}
        </Button>
      </Section>

      <Section
        title={t("settings.reset.title")}
        description={t("settings.reset.desc")}
      >
        <Button variant="outline" onClick={resetSettings} className="w-full">
          <RefreshCw className="w-3.5 h-3.5 mr-2" />
          {t("settings.reset.action")}
        </Button>
      </Section>

      <Section
        title={t("settings.danger.title")}
        description={t("settings.danger.desc")}
      >
        {!confirmingClear ? (
          <Button
            variant="outline"
            onClick={() => setConfirmingClear(true)}
            className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            {t("settings.danger.wipe")}
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-destructive font-medium">
              {t("settings.danger.confirm")}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleClear}
                disabled={busy}
                className="flex-1 bg-destructive text-white hover:bg-destructive/90"
              >
                {busy ? t("settings.danger.deleting") : t("settings.danger.yes")}
              </Button>
              <Button
                onClick={() => setConfirmingClear(false)}
                variant="outline"
                disabled={busy}
                className="flex-1"
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

// ---------- Diagnostics ----------

// GitHub repo behind feedback issues + the updater endpoint.
const FEEDBACK_REPO = "bunhine0452/Ocul-PM";

/** Short OS label for prefilling feedback issues (best-effort from the webview UA). */
function platformLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Linux")) return "Linux";
  return ua.slice(0, 60);
}

function DiagnosticsTab({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

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
    commands.appInfo().then((res) => {
      if (res.status === "ok") setVersion(res.data.version);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openIssue(kind: "bug" | "feature") {
    const isBug = kind === "bug";
    const title = isBug ? t("settings.feedback.bugTitle") : t("settings.feedback.featureTitle");
    const body = [
      isBug
        ? t("settings.feedback.bugBody1")
        : t("settings.feedback.featureBody1"),
      isBug
        ? t("settings.feedback.bugBody2")
        : t("settings.feedback.featureBody2"),
      "---",
      t("settings.feedback.appVersion", { version: version ?? "?" }),
      `- OS: ${platformLabel()}`,
    ].join("\n");
    const url =
      `https://github.com/${FEEDBACK_REPO}/issues/new` +
      `?labels=${encodeURIComponent(isBug ? "bug" : "enhancement")}` +
      `&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    void commands.openUrl(url).then((res) => {
      if (res.status === "error") toast.destructive(t("settings.feedback.openFailed", { error: res.error }));
    });
  }

  return (
    <>
      <Section
        title={t("settings.db.title")}
        description={t("settings.db.desc")}
      >
        <div className="grid grid-cols-3 gap-2">
          <Stat label="SQLite" value={health?.sqlite_version} />
          <Stat label="sqlite-vec" value={health?.vec_version} />
          <Stat label={t("settings.db.schema")} value={health ? `v${health.schema_version}` : undefined} />
        </div>
        <div className="text-[11px] font-mono break-all text-muted-foreground">
          {health?.path ?? t("settings.db.noPath")}
        </div>
        <Button onClick={check} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          {t("settings.db.refresh")}
        </Button>
      </Section>

      <Section
        title={t("settings.feedback.title")}
        description={t("settings.feedback.desc")}
      >
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => openIssue("bug")} variant="outline" size="sm">
            <Bug className="w-3.5 h-3.5 mr-1.5" />
            {t("settings.feedback.bug")}
          </Button>
          <Button onClick={() => openIssue("feature")} variant="outline" size="sm">
            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
            {t("settings.feedback.feature")}
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t("settings.feedback.note")}
        </div>
      </Section>
    </>
  );
}

// Repo behind the updater endpoint (tauri.conf.json) — used to fetch live patch
// notes (the latest release body == the installed version when up to date).
// All recent releases (newest first), so the patch-notes section can show past
// versions too — not just the latest.
const RELEASES_API = "https://api.github.com/repos/bunhine0452/Ocul-PM/releases?per_page=20";

interface ReleaseNote {
  tag: string;
  date: string;
  highlights: string;
}

function UpdateTab() {
  const { t } = useT();
  const { status: updater, check: checkUpdate, install: installUpdate } = useUpdater();
  const [version, setVersion] = useState<string | null>(null);
  const [releases, setReleases] = useState<ReleaseNote[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [notesLoading, setNotesLoading] = useState(true);

  const toggleRelease = (tag: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  useEffect(() => {
    commands.appInfo().then((res) => {
      if (res.status === "ok") setVersion(res.data.version);
    });
    // Auto-check on open so the update state isn't hidden behind a manual click.
    void checkUpdate();
    // Live patch notes from GitHub releases (public repo, CORS-enabled; offline /
    // rate-limited just falls back to the empty-state message). Newest first.
    fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const list: ReleaseNote[] = (Array.isArray(data) ? data : [])
          .filter((r) => r && !r.draft)
          .map((r) => ({
            tag: String(r.tag_name || r.name || ""),
            date: typeof r.published_at === "string" ? r.published_at.slice(0, 10) : "",
            highlights: r.body ? releaseHighlights(r.body) : "",
          }))
          .filter((r) => r.tag);
        setReleases(list);
        // Expand the newest release by default.
        setOpen(new Set(list.slice(0, 1).map((r) => r.tag)));
      })
      .catch(() => setReleases(null))
      .finally(() => setNotesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Section
        title={t("settings.update.title")}
        description={t("settings.update.desc")}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {t("settings.update.current")}{" "}
            <span className="font-mono text-foreground">v{version ?? "—"}</span>
          </div>
          {updater.kind === "available" ? (
            <Button
              onClick={() => void installUpdate()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Download className="w-3.5 h-3.5 mr-2" />
              {t("settings.update.installRestart", { version: updater.version ?? "" })}
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
              {t("settings.update.check")}
            </Button>
          )}
        </div>
        {updater.kind === "checking" && (
          <p className="text-[11px] text-muted-foreground">{t("settings.update.checking")}</p>
        )}
        {updater.kind === "uptodate" && (
          <p className="text-[11px] text-primary">{t("settings.update.upToDate")}</p>
        )}
        {updater.kind === "available" && (
          <p className="text-[11px] text-muted-foreground">
            {t("settings.update.availPrefix")} <span className="font-mono">v{updater.version}</span> {t("settings.update.availSuffix")}
          </p>
        )}
        {updater.kind === "installing" && (
          <p className="text-[11px] text-muted-foreground">
            {t("settings.update.installing")}
          </p>
        )}
        {updater.kind === "error" && (
          <p className="text-[11px] text-destructive">
            {t("settings.update.checkFailed", { message: updater.message ?? "" })}
          </p>
        )}
      </Section>

      <Section title={t("settings.changelog.title")} description={t("settings.changelog.desc")}>
        {notesLoading ? (
          <span className="text-xs text-muted-foreground">{t("settings.changelog.loading")}</span>
        ) : releases && releases.length > 0 ? (
          <div className="space-y-1.5 max-h-[440px] overflow-y-auto scrollbar-thin pr-1">
            {releases.map((rel) => {
              const isOpen = open.has(rel.tag);
              return (
                <div key={rel.tag} className="rounded-md border border-border bg-muted/20">
                  <button
                    type="button"
                    onClick={() => toggleRelease(rel.tag)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer"
                    aria-expanded={isOpen}
                  >
                    <span className="font-mono text-xs font-semibold text-foreground">{rel.tag}</span>
                    {rel.date ? (
                      <span className="text-[11px] text-muted-foreground">{rel.date}</span>
                    ) : null}
                    <span className="ml-auto text-[10px] text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
                  </button>
                  {isOpen ? (
                    <div className="border-t border-border px-3 py-2 text-xs leading-relaxed [&_h3]:text-xs [&_h3]:font-semibold [&_ul]:my-1 [&_li]:my-0.5">
                      {rel.highlights ? (
                        <Markdown>{rel.highlights}</Markdown>
                      ) : (
                        <span className="text-muted-foreground">{t("settings.changelog.empty")}</span>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("settings.changelog.failed")}
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
  const { t } = useT();
  const [tab, setTab] = useState<TabId>("appearance");
  const [error, setError] = useState<string | null>(null);
  const { loaded } = useSettings();

  const activeTab = useMemo(() => {
    switch (tab) {
      case "appearance":
        return <AppearanceTab />;
      case "llm":
        return <LlmTab onError={setError} />;
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

  // 탭 내비게이션은 두 진입점에서 모양이 다르다.
  //
  // 프로젝트 안(embedded)에서는 왼쪽에 이미 앱 사이드바가 있어서, 세로 192px
  // 열을 하나 더 세우면 '사이드바 속 사이드바' 가 된다 (2026-07-30 디자인
  // 라운드). embedded 일 때만 가로 스트립으로 눕혀 좌측 열을 없앤다. 좁은
  // 창에서는 압착 대신 가로 스크롤로 도망가게 한다 — 툴바 액션과 같은 방어책
  // 으로, 없으면 flex 압착이 CJK 라벨을 한 글자씩 세로로 꺾는다.
  //
  // 프로젝트 선택 화면(비-embedded)은 사이드바가 없는 모달이라 세로 목록이
  // 여전히 맞다.
  const tabNav = embedded ? (
    <nav
      className="flex items-center gap-1 overflow-x-auto border-b border-border/60 px-1 pb-2 mb-5"
      style={{ scrollbarWidth: "none" }}
    >
      {TABS.map((entry) => {
        const isActive = tab === entry.id;
        return (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            aria-current={isActive ? "page" : undefined}
            className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            }`}
          >
            {t(entry.labelKey)}
          </button>
        );
      })}
    </nav>
  ) : (
    <nav className="w-48 flex-shrink-0 border-r border-border/60 bg-background/40 p-2 space-y-0.5">
      {TABS.map((entry) => {
        const Icon = entry.icon;
        const isActive = tab === entry.id;
        return (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            aria-current={isActive ? "page" : undefined}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {t(entry.labelKey)}
          </button>
        );
      })}
    </nav>
  );

  const body = (
    <div className={embedded ? "flex flex-col" : "flex"}>
      {tabNav}

      {/* Tab content */}
      <div
        className={`flex-1 ${
          embedded ? "pb-6" : "p-6 overflow-y-auto max-h-[70vh] scrollbar-thin"
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
        <h2 className="text-lg font-heading font-semibold">{t("shell.settings.title")}</h2>
      </header>
      {body}
    </section>
  );
}

