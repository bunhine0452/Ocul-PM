// 외형 탭 — 테마·강조색·언어·터미널 폰트·메뉴바 섹션.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commands } from "@/lib/bindings";
import { Sun, Moon, Monitor, Languages } from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { toast } from "@/lib/toast";
import { type ColorTheme, type Theme } from "@/lib/settings";
import { TERM_FONT_MIN, TERM_FONT_MAX, TERM_FONT_DEFAULT, clampTermFont } from "@/features/terminal/fontSize";
import { normalizeLangSetting, resolveLang, useT, type I18nKey, type LangSetting } from "@/i18n";
import { Section, Field } from "./ui";

// Preset themes shown in 모양 → 테마. Each `id` is a `Theme` value the
// SettingsContext turns into `data-preset` over a light/dark base family. The
// swatch colors mirror the palette in tokens.css / App.css so the picker shows a
// faithful mini-preview without loading the theme.
export const THEME_PRESETS: Array<{
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
export const ACCENTS: Array<{ id: ColorTheme; labelKey: I18nKey; color: string }> = [
  { id: "green", labelKey: "settings.accent.green", color: "#0e8a60" },
  { id: "blue", labelKey: "settings.accent.blue", color: "#2570e0" },
  { id: "purple", labelKey: "settings.accent.purple", color: "#7c5cdb" },
  { id: "orange", labelKey: "settings.accent.orange", color: "#e07b12" },
  { id: "rose", labelKey: "settings.accent.rose", color: "#e0524b" },
  { id: "teal", labelKey: "settings.accent.teal", color: "#0e9aa0" },
];

export function AccentPicker() {
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
export function LangPicker({
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
export function LanguageSection() {
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

export function AppearanceTab() {
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

      <TerminalFontSection />

      <MenubarSection />
    </>
  );
}

/**
 * 터미널 글자 크기 (2026-08-15).
 *
 * 앱 배율(`uiScale`)과 별개다 — 터미널은 고정폭 격자라 배율로 키우면 셀 폭과
 * 폰트가 어긋나 줄이 밀린다. px 를 직접 정하는 편이 정확하고, 사용자가 원한
 * 것도 그것이다. 값은 SQLite 라 도크·터미널 화면·분리 창이 전부 같이 움직인다.
 */
export function TerminalFontSection() {
  const { t } = useT();
  const { settings, set } = useSettings();
  const px = clampTermFont(settings.terminalFontSize || TERM_FONT_DEFAULT);
  // 타이핑 중 초안 — "1"(18 을 치는 중)이 곧장 9 로 튀지 않게 커밋을 미룬다.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = Number.parseInt(draft, 10);
    if (Number.isFinite(parsed)) void set("terminalFontSize", clampTermFont(parsed));
    setDraft(null);
  };

  return (
    <Section title={t("settings.termFont.title")} description={t("settings.termFont.desc")}>
      <Field label={t("settings.termFont.field", { px })}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            aria-label={t("settings.termFont.title")}
            min={TERM_FONT_MIN}
            max={TERM_FONT_MAX}
            step={1}
            value={px}
            onChange={(e) => void set("terminalFontSize", clampTermFont(Number(e.target.value)))}
            className="flex-1 accent-[color:var(--primary)]"
          />
          <input
            type="number"
            min={TERM_FONT_MIN}
            max={TERM_FONT_MAX}
            step={1}
            value={draft ?? String(px)}
            aria-label={t("settings.termFont.input")}
            title={t("settings.termFont.range", { min: TERM_FONT_MIN, max: TERM_FONT_MAX })}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              const parsed = Number.parseInt(raw, 10);
              // 범위 안 값만 즉시 반영. 범위 밖·빈 값은 blur/Enter 에서 정리.
              if (parsed >= TERM_FONT_MIN && parsed <= TERM_FONT_MAX) {
                void set("terminalFontSize", parsed);
              }
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(null);
                e.currentTarget.blur();
              }
            }}
            className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-mono tabular-nums text-right text-foreground"
          />
          <span className="text-xs text-muted-foreground">px</span>
        </div>
      </Field>

      {/* 실제 터미널 폰트로 그린 미리보기 — 슬라이더만 있으면 "9px 이 얼마나
          작은지"를 터미널 화면에 가서야 알게 된다. */}
      <div
        className="rounded-lg border border-border bg-[color:var(--term-bg)] px-3 py-2.5 overflow-x-auto"
        aria-hidden="true"
      >
        <pre
          className="m-0 text-[color:var(--term-fg)]"
          style={{
            fontSize: px,
            lineHeight: 1.2,
            fontFamily: 'Menlo, "D2Coding Term", "SF Mono", ui-monospace, monospace',
          }}
        >
          {t("settings.termFont.preview")}
        </pre>
      </div>

      <p className="text-xs text-muted-foreground">{t("settings.termFont.hint")}</p>
    </Section>
  );
}

/**
 * v2.3.0 메뉴바 상주 토글 3종 (docs/menubar/00-master-plan.md D4) — 전부 옵인,
 * 기본은 현행 동작. 키는 SQLite settings_* 직접 사용 (SettingsContext 의 정형
 * 키가 아니라 트레이 전용): tray.show_icon(기본 on) · tray.keep_running ·
 * tray.hide_dock(keep_running 이 켜져 있을 때만 의미).
 */
export function MenubarSection() {
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
