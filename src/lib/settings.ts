// Centralized app settings registry. All keys, defaults, and types live here.
// Settings are persisted in the SQLite `settings` table via Tauri commands.

export type Theme = "light" | "dark" | "system";
export type UiDensity = "compact" | "comfortable";
export type Provider = "anthropic" | "openai" | "gemini";
export type LogLevel = "error" | "warn" | "info" | "debug";

export const PROVIDERS: Provider[] = ["anthropic", "openai", "gemini"];

/// Every setting we recognize. Keys are the exact column values in the
/// `settings` SQLite table; values are stringified.
export const KEYS = {
  // --- Appearance / editor ---
  theme: "theme",
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

  // --- Dependency graph ---
  graphShowIsolated: "graph_show_isolated",
  graphGroupThreshold: "graph_group_threshold",

  // --- Diagnostics ---
  logLevel: "log_level",
} as const;

export type SettingKey = (typeof KEYS)[keyof typeof KEYS];

export interface Settings {
  theme: Theme;
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
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  streamResponses: boolean;

  chunkSize: number;
  chunkOverlap: number;
  ragTopK: number;
  maxFileSizeKb: number;
  excludePatterns: string;

  graphShowIsolated: boolean;
  graphGroupThreshold: number;

  logLevel: LogLevel;
}

export const DEFAULTS: Settings = {
  theme: "system",
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
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: "",
  streamResponses: true,

  chunkSize: 30,
  chunkOverlap: 4,
  ragTopK: 5,
  maxFileSizeKb: 500,
  excludePatterns: "",

  graphShowIsolated: false,
  graphGroupThreshold: 3,

  logLevel: "info",
};

const KEY_TO_FIELD: Record<string, keyof Settings> = {
  [KEYS.theme]: "theme",
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
  [KEYS.temperature]: "temperature",
  [KEYS.maxTokens]: "maxTokens",
  [KEYS.systemPrompt]: "systemPrompt",
  [KEYS.streamResponses]: "streamResponses",
  [KEYS.chunkSize]: "chunkSize",
  [KEYS.chunkOverlap]: "chunkOverlap",
  [KEYS.ragTopK]: "ragTopK",
  [KEYS.maxFileSizeKb]: "maxFileSizeKb",
  [KEYS.excludePatterns]: "excludePatterns",
  [KEYS.graphShowIsolated]: "graphShowIsolated",
  [KEYS.graphGroupThreshold]: "graphGroupThreshold",
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
  }
}
