// Centralized app settings registry. All keys, defaults, and types live here.
// Settings are persisted in the SQLite `settings` table via Tauri commands.

export type Theme = "light" | "dark" | "system";
/** Accent color palette, applied via `[data-accent]` over light/dark tokens. */
export type ColorTheme = "green" | "blue" | "purple" | "orange" | "rose" | "teal";
export type UiDensity = "compact" | "comfortable";
export type Provider = "anthropic" | "openai" | "gemini" | "nim" | "openrouter";
export type LogLevel = "error" | "warn" | "info" | "debug";

export const PROVIDERS: Provider[] = ["anthropic", "openai", "gemini", "nim", "openrouter"];

/// Every setting we recognize. Keys are the exact column values in the
/// `settings` SQLite table; values are stringified.
export const KEYS = {
  // --- Appearance / editor ---
  theme: "theme",
  colorTheme: "color_theme",
  uiDensity: "ui_density",
  editorFontFamily: "editor_font_family",
  editorFontSize: "editor_font_size",
  editorTabWidth: "editor_tab_width",
  editorWordWrap: "editor_word_wrap",
  editorShowLineNumbers: "editor_show_line_numbers",
  editorActiveLineHighlight: "editor_active_line_highlight",
  editorIndentGuides: "editor_indent_guides",

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
  streamResponses: "stream_responses",

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

  // --- Diagnostics ---
  logLevel: "log_level",
} as const;

export type SettingKey = (typeof KEYS)[keyof typeof KEYS];

export interface Settings {
  theme: Theme;
  colorTheme: ColorTheme;
  uiDensity: UiDensity;

  editorFontFamily: string;
  editorFontSize: number;
  editorTabWidth: number;
  editorWordWrap: boolean;
  editorShowLineNumbers: boolean;
  editorActiveLineHighlight: boolean;
  editorIndentGuides: boolean;

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
  streamResponses: boolean;

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

  logLevel: LogLevel;
}

export const DEFAULTS: Settings = {
  theme: "system",
  colorTheme: "green",
  uiDensity: "comfortable",

  editorFontFamily: "D2Coding",
  editorFontSize: 13,
  editorTabWidth: 2,
  editorWordWrap: false,
  editorShowLineNumbers: true,
  editorActiveLineHighlight: true,
  editorIndentGuides: true,

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
  streamResponses: true,

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

  logLevel: "info",
};

const KEY_TO_FIELD: Record<string, keyof Settings> = {
  [KEYS.theme]: "theme",
  [KEYS.colorTheme]: "colorTheme",
  [KEYS.uiDensity]: "uiDensity",
  [KEYS.editorFontFamily]: "editorFontFamily",
  [KEYS.editorFontSize]: "editorFontSize",
  [KEYS.editorTabWidth]: "editorTabWidth",
  [KEYS.editorWordWrap]: "editorWordWrap",
  [KEYS.editorShowLineNumbers]: "editorShowLineNumbers",
  [KEYS.editorActiveLineHighlight]: "editorActiveLineHighlight",
  [KEYS.editorIndentGuides]: "editorIndentGuides",
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
  [KEYS.streamResponses]: "streamResponses",
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
  [KEYS.logLevel]: "logLevel",
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

// Convenience: the resolved model for the current provider, falling back to
// `defaultModel` and finally to the provider-specific default.
export function resolveModel(settings: Settings): string {
  const m = providerModel(settings, settings.defaultProvider);
  if (m) return m;
  if (settings.defaultModel) return settings.defaultModel;
  return DEFAULTS.modelAnthropic;
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
