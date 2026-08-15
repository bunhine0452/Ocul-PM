// Centralized app settings registry. All keys, defaults, and types live here.
// Settings are persisted in the SQLite `settings` table via Tauri commands.

import type { LangSetting } from "@/i18n";
import { TERM_FONT_DEFAULT } from "@/features/terminal/fontSize";

export type Theme =
  | "light"
  | "dark"
  | "system"
  // Full preset palettes. Each layers a named palette (`data-preset`) over a
  // light/dark base family (`data-theme`) — see PRESET_FAMILY in SettingsContext.
  | "solarized"
  | "nord"
  | "dracula"
  | "sepia"
  | "high-contrast";
/** Accent color palette, applied via `[data-accent]` over light/dark tokens. */
export type ColorTheme = "green" | "blue" | "purple" | "orange" | "rose" | "teal";
export type Provider = "anthropic" | "openai" | "gemini" | "nim" | "openrouter";

export const PROVIDERS: Provider[] = ["anthropic", "openai", "gemini", "nim", "openrouter"];

/// Every setting we recognize. Keys are the exact column values in the
/// `settings` SQLite table; values are stringified.
export const KEYS = {
  // --- Appearance ---
  theme: "theme",
  colorTheme: "color_theme",
  uiScale: "ui_scale",
  // 터미널 글자 크기(px). 2026-08-15 에 프로젝트별 워크스페이스(localStorage)
  // 에서 여기로 옮겼다 — 프로젝트마다 다를 이유가 없는 개인 취향이고, 도크·
  // 터미널 화면·분리 창이 **같은 값**을 봐야 하기 때문이다 (SQLite 라 창을
  // 여러 개 띄워도 한 값이다).
  terminalFontSize: "terminal_font_size",
  // UI 언어. SQLite 에 있으므로 창을 여러 개 띄워도 전 창이 같은 값을 본다
  // (localStorage 가 아니다 — docs/20260811_three-features/00-master-plan.md D4).
  language: "language",
  // AI 가 **쓰는** 언어 (일지·플랜·회고). UI 언어와 의도적으로 분리한다 —
  // UI 는 즉시 되돌릴 수 있지만 일지는 디스크에 남아 되돌릴 수 없다.
  contentLanguage: "content_language",

  // --- LLM ---
  defaultProvider: "default_provider",
  defaultModel: "default_model", // legacy fallback model (still respected)
  modelAnthropic: "model_anthropic",
  modelOpenai: "model_openai",
  modelGemini: "model_gemini",
  modelNim: "model_nim",
  modelOpenrouter: "model_openrouter",
  // Failover chain — newline-separated `provider:model` lines, tried in order
  // when the primary call fails. Parsed by `parseFallbacks`.
  fallbackModels: "fallback_models",
  temperature: "temperature",
  maxTokens: "max_tokens",
  systemPrompt: "system_prompt",

  // --- Indexing / RAG ---
  chunkSize: "chunk_size",
  chunkOverlap: "chunk_overlap",
  ragTopK: "rag_top_k",
  maxFileSizeKb: "max_file_size_kb",
  excludePatterns: "exclude_patterns",
  // When on, the filesystem watcher incrementally reindexes a file as soon as
  // it changes on disk (keeps an existing index fresh without a manual rebuild).
  autoIndex: "auto_index",

  // --- AI 작업 맥락 (oculpm 기록 주입) ---
  includeOculpmContext: "include_oculpm_context",
  oculpmContextEntries: "oculpm_context_entries",

  // --- Dependency graph ---
  graphShowIsolated: "graph_show_isolated",
  graphGroupThreshold: "graph_group_threshold",

  // --- External editor (Lite-W6 PR8 Part 2) ---
  externalEditorCommand: "external_editor_command",

  // (streamResponses / logLevel 은 감사 2026-07-16 에서 제거 — 소비처 없음.)
} as const;

export type SettingKey = (typeof KEYS)[keyof typeof KEYS];

export interface Settings {
  theme: Theme;
  colorTheme: ColorTheme;
  /** App-wide UI scale (zoom). 1 = 100%. Applied as CSS `zoom` on <html> so
   *  both rem-based (shadcn) and px-based (ui_v2) text scale uniformly. */
  uiScale: number;
  /**
   * 터미널 글자 크기 (px). 범위·클램프는 `@/features/terminal/fontSize`.
   * ⌘+/⌘−/⇧⌘0 과 터미널 상태바의 px 입력, 설정 화면이 모두 이 한 값을 쓴다.
   */
  terminalFontSize: number;
  /** UI 언어. "system" 은 OS 로케일을 따른다 (`resolveLang` — src/i18n). */
  language: LangSetting;
  /**
   * LLM 이 생성하는 산출물(작업 일지·플래너 항목·회고)의 언어.
   *
   * **`language` 를 따라가지 않는다.** UI 언어는 화면 텍스트만 바꾸고 언제든
   * 되돌릴 수 있지만, 이 값은 `.oculpm/journal/*.md` 처럼 디스크에 영구히
   * 남는 문서의 언어를 정한다. UI 를 영어로 바꿨다는 이유로 일지가 조용히
   * 영어로 넘어가면 언어가 섞인 이력이 남고 되돌릴 방법이 없다.
   * 설정에서 UI 언어를 바꾸면 이 값도 맞출지 **토스트로 제안**한다.
   */
  contentLanguage: LangSetting;

  defaultProvider: Provider;
  defaultModel: string;
  modelAnthropic: string;
  modelOpenai: string;
  modelGemini: string;
  modelNim: string;
  modelOpenrouter: string;
  /** Failover chain as raw text — one `provider:model` per line. */
  fallbackModels: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;

  chunkSize: number;
  chunkOverlap: number;
  ragTopK: number;
  maxFileSizeKb: number;
  excludePatterns: string;
  /** Incrementally reindex changed files via the watcher (no manual rebuild). */
  autoIndex: boolean;

  /**
   * When true the chat prepends a "프로젝트 작업 맥락" block built from the most
   * recent oculpm journal entries + the project's AGENTS rules, so the
   * assistant keeps the same direction across sessions / model swaps.
   */
  includeOculpmContext: boolean;
  /** How many recent journal entries to summarise into that block. */
  oculpmContextEntries: number;

  graphShowIsolated: boolean;
  graphGroupThreshold: number;

  /**
   * Shell command template launched by `commands.openInEditor`. `%path` is
   * substituted with the absolute file path (shell-quoted). Default is the
   * VS Code CLI; users on Cursor / Sublime / etc. override here.
   */
  externalEditorCommand: string;

}

export const DEFAULTS: Settings = {
  theme: "system",
  colorTheme: "green",
  uiScale: 1,
  terminalFontSize: TERM_FONT_DEFAULT,
  language: "system",
  contentLanguage: "system",

  defaultProvider: "anthropic",
  defaultModel: "",
  modelAnthropic: "claude-sonnet-4-6",
  modelOpenai: "gpt-4o-mini",
  modelGemini: "gemini-2.5-flash",
  // NVIDIA NIM default — generally-available, competitive open-weights model.
  // Users override per-project in Settings → LLM.
  modelNim: "meta/llama-3.3-70b-instruct",
  modelOpenrouter: "openai/gpt-4o-mini",
  fallbackModels: "",
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: "",

  chunkSize: 30,
  chunkOverlap: 4,
  ragTopK: 5,
  maxFileSizeKb: 500,
  excludePatterns: "",
  autoIndex: true,

  includeOculpmContext: true,
  oculpmContextEntries: 5,

  graphShowIsolated: false,
  graphGroupThreshold: 3,

  externalEditorCommand: 'code "%path"',

};

const KEY_TO_FIELD: Record<string, keyof Settings> = {
  [KEYS.theme]: "theme",
  [KEYS.colorTheme]: "colorTheme",
  [KEYS.uiScale]: "uiScale",
  [KEYS.terminalFontSize]: "terminalFontSize",
  [KEYS.language]: "language",
  [KEYS.contentLanguage]: "contentLanguage",
  [KEYS.defaultProvider]: "defaultProvider",
  [KEYS.defaultModel]: "defaultModel",
  [KEYS.modelAnthropic]: "modelAnthropic",
  [KEYS.modelOpenai]: "modelOpenai",
  [KEYS.modelGemini]: "modelGemini",
  [KEYS.modelNim]: "modelNim",
  [KEYS.modelOpenrouter]: "modelOpenrouter",
  [KEYS.fallbackModels]: "fallbackModels",
  [KEYS.temperature]: "temperature",
  [KEYS.maxTokens]: "maxTokens",
  [KEYS.systemPrompt]: "systemPrompt",
  [KEYS.chunkSize]: "chunkSize",
  [KEYS.chunkOverlap]: "chunkOverlap",
  [KEYS.ragTopK]: "ragTopK",
  [KEYS.maxFileSizeKb]: "maxFileSizeKb",
  [KEYS.excludePatterns]: "excludePatterns",
  [KEYS.autoIndex]: "autoIndex",
  [KEYS.includeOculpmContext]: "includeOculpmContext",
  [KEYS.oculpmContextEntries]: "oculpmContextEntries",
  [KEYS.graphShowIsolated]: "graphShowIsolated",
  [KEYS.graphGroupThreshold]: "graphGroupThreshold",
  [KEYS.externalEditorCommand]: "externalEditorCommand",
};

const FIELD_TO_KEY = Object.fromEntries(
  Object.entries(KEY_TO_FIELD).map(([k, v]) => [v, k as SettingKey])
) as Record<keyof Settings, SettingKey>;

export function keyForField<K extends keyof Settings>(field: K): SettingKey {
  return FIELD_TO_KEY[field];
}

function coerce<K extends keyof Settings>(field: K, raw: string): Settings[K] {
  const def = DEFAULTS[field];
  if (typeof def === "boolean") {
    return (raw === "true") as Settings[K];
  }
  if (typeof def === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : def) as Settings[K];
  }
  // string-typed
  return raw as Settings[K];
}

export function serialize<K extends keyof Settings>(_field: K, value: Settings[K]): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/// Convert the raw key/value entries returned by `settings_get_all` into a
/// fully-typed `Settings` object with defaults applied.
export function entriesToSettings(entries: Array<[string, string]>): Settings {
  const result: Settings = { ...DEFAULTS };
  for (const [k, v] of entries) {
    const field = KEY_TO_FIELD[k];
    if (!field) continue;
    (result as any)[field] = coerce(field, v);
  }
  return result;
}

export function providerModel(settings: Settings, provider: Provider): string {
  switch (provider) {
    case "anthropic":
      return settings.modelAnthropic || settings.defaultModel || DEFAULTS.modelAnthropic;
    case "openai":
      return settings.modelOpenai || settings.defaultModel || DEFAULTS.modelOpenai;
    case "gemini":
      return settings.modelGemini || settings.defaultModel || DEFAULTS.modelGemini;
    case "nim":
      return settings.modelNim || settings.defaultModel || DEFAULTS.modelNim;
    case "openrouter":
      return settings.modelOpenrouter || settings.defaultModel || DEFAULTS.modelOpenrouter;
  }
}

// Parse the failover chain (`fallbackModels` text) into ordered
// {provider, model} entries for the chat commands. Each line is
// `provider:model` (model ids may themselves contain `:` so we split once).
// Unknown providers and malformed lines are dropped.
export function parseFallbacks(settings: Settings): { provider: Provider; model: string }[] {
  return settings.fallbackModels
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx < 0) return null;
      const provider = line.slice(0, idx).trim().toLowerCase();
      const model = line.slice(idx + 1).trim();
      if (!model || !(PROVIDERS as string[]).includes(provider)) return null;
      return { provider: provider as Provider, model };
    })
    .filter((v): v is { provider: Provider; model: string } => v !== null);
}
