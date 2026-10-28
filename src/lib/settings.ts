// Centralized app settings registry. All keys, defaults, and types live here.
// Settings are persisted in the SQLite `settings` table via Tauri commands.

import type { LangSetting } from "@/i18n";

/** 밝게 / 어둡게 / 시스템. (옛 프리셋 id·`custom:<id>` 가 저장돼 있으면 `"system"` 으로 읽는다.) */
export type Theme = "light" | "dark" | "system";
/** Accent color palette, applied via `[data-accent]` over light/dark tokens. */
export type ColorTheme = "green" | "blue" | "purple" | "orange" | "rose" | "teal";
export type Provider = "anthropic" | "openai" | "gemini" | "nim" | "openrouter";

/** 자동 저장 방식 — `src/features/code/autoSave.ts` 가 해석한다. */
export type AutoSaveMode = "off" | "afterDelay" | "onFocusChange";
export const AUTO_SAVE_MODES: AutoSaveMode[] = ["off", "afterDelay", "onFocusChange"];

/**
 * 스티키 스크롤이 겹쳐 고정할 줄 수의 범위 (VS Code `maxLineCount` 와 같은 기본 5).
 *
 * 이 값들이 편집기 쪽이 아니라 여기 있는 이유: 스티키 자체는 이제 Monaco 내장이라
 * (Phase 2 `{#reclaim-sticky}` — 손으로 만든 `stickyModel.ts` 는 지웠다) 우리에게
 * 남은 몫은 **설정값을 쓸 수 있는 범위로 접는 것** 하나뿐이다.
 */
export const STICKY_MIN_LINES = 1;
export const STICKY_MAX_LINES = 10;

/** 설정값을 쓸 수 있는 줄 수로 접는다. 쓰레기 값은 기본 5. */
export function clampStickyMax(raw: number): number {
  if (!Number.isFinite(raw)) return 5;
  return Math.min(STICKY_MAX_LINES, Math.max(STICKY_MIN_LINES, Math.trunc(raw)));
}

export const PROVIDERS: Provider[] = ["anthropic", "openai", "gemini", "nim", "openrouter"];

/// Every setting we recognize. Keys are the exact column values in the
/// `settings` SQLite table; values are stringified.
export const KEYS = {
  // --- Appearance ---
  theme: "theme",
  colorTheme: "color_theme",
  uiScale: "ui_scale",
  // (`ui_density` 「간단 / 전문」은 4.0 에서 걷었다 — 밀도는 하나다. 옛 값은 DB 에 남는다.)
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
  // 배경 작업 전용 모델 슬롯 (Osaurus 라운드 D2). 자동 화해·일지 초안·스케줄·
  // 감시가 **전부** 이 슬롯을 쓴다 — 대화 모델과 따로 두는 이유는 배경 작업이
  // 자주, 조용히, 과금되기 때문이다. 비어 있으면 그 작업은 성립 불가(조용한 스킵).
  coreProvider: "core_provider",
  coreModel: "core_model",
  // 자동화를 이미 켜 둔 사용자에게 대화 모델을 1회 시드했다는 표식
  // (`"<provider>:<model>"`). 안내 카드가 이걸 보고 한 번 뜨고, 닫으면 비운다.
  coreModelSeeded: "core_model_seeded",
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
  // 의미검색이 `.oculpm/journal/**` · `.oculpm/rollups/**` 도 색인·검색할지
  // (journal-scale-round {#search-semantic-journal}). 기본 켬 — 일지는 4MB
  // 규모라 비용이 작고, 끄면 기존과 완전히 같다.
  searchIncludeJournal: "search_include_journal",

  // --- AI 작업 맥락 (oculpm 기록 주입) ---
  includeOculpmContext: "include_oculpm_context",
  oculpmContextEntries: "oculpm_context_entries",

  // --- External editor (Lite-W6 PR8 Part 2) ---
  externalEditorCommand: "external_editor_command",

  // (첫 실행 마법사의 `onboarded` 는 4.0 에서 걷었다 — 시작 창의 「처음이라면 세
  // 단계」가 늘 보이므로 한 번 봤는지 적을 일이 없다.)

  // --- 업데이트 ---
  // 마지막으로 What's-new 카드를 본 앱 버전. 앱 버전이 이보다 새로우면 Today 가
  // 한 번 릴리스 노트를 보여 준다. 빈 문자열 = 아직 한 번도 기록 안 함(첫 설치).
  lastSeenVersion: "last_seen_version",
  // Today 플러그인 안내 카드를 사용자가 닫았는가 (v3-release
  // {#plugin-card-dismiss}). 카드의 표시 조건은 이미 좁지만(일지 0건 + Claude
  // Code 설치됨 + 플러그인 못 찾음) "안 깔 것"을 고른 사람에게는 그 셋이 다
  // 참인 채로 남는다 — 닫을 길이 없으면 카드가 사용자를 이긴다.
  pluginCardDismissed: "plugin_card_dismissed",
  // 첫 실행 세 단계 시트를 「이미 알아요 — 건너뛰기」로 내렸는가 (UI 밀도 라운드 3).
  // 첫 일지가 서면 시트는 스스로 접히므로 이 키는 건너뛴 사람만 적는다.
  firstRunSheetDismissed: "first_run_sheet_dismissed",

  // (streamResponses / logLevel 은 감사 2026-07-16 에서 제거 — 소비처 없음.)
} as const;

export type SettingKey = (typeof KEYS)[keyof typeof KEYS];

export interface Settings {
  theme: Theme;
  colorTheme: ColorTheme;
  /** App-wide UI scale (zoom). 1 = 100%. Applied as CSS `zoom` on <html> so
   *  both rem-based (shadcn) and px-based (ui_v2) text scale uniformly. */
  uiScale: number;
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
  /**
   * 배경 작업 모델 (Osaurus 라운드 D2). `""` = 미설정 → 자동화가 돌지 않는다.
   * 대화 모델(`defaultProvider`/`defaultModel`)과 의도적으로 분리한다.
   */
  coreProvider: Provider | "";
  coreModel: string;
  /** 1회 시드가 일어났다는 표식 (`"<provider>:<model>"`). `""` = 없음/확인함. */
  coreModelSeeded: string;
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
  /** 의미검색 색인에 일지·롤업을 포함한다. */
  searchIncludeJournal: boolean;

  /**
   * When true the chat prepends a "프로젝트 작업 맥락" block built from the most
   * recent oculpm journal entries + the project's AGENTS rules, so the
   * assistant keeps the same direction across sessions / model swaps.
   */
  includeOculpmContext: boolean;
  /** How many recent journal entries to summarise into that block. */
  oculpmContextEntries: number;

  /**
   * Shell command template launched by `commands.openInEditor`. `%path` is
   * substituted with the absolute file path (shell-quoted). Default is the
   * VS Code CLI; users on Cursor / Sublime / etc. override here.
   */
  externalEditorCommand: string;



  /** What's-new 카드를 마지막으로 본 버전 (`""` = 기록 없음). */
  lastSeenVersion: string;

  /** Today 플러그인 안내 카드를 닫았는가 (`true` = 다시 뜨지 않는다). */
  pluginCardDismissed: boolean;

  /** 첫 실행 세 단계 시트를 건너뛰었는가 (첫 일지가 서면 시트는 어차피 접힌다). */
  firstRunSheetDismissed: boolean;
}

export const DEFAULTS: Settings = {
  theme: "system",
  colorTheme: "green",
  uiScale: 1,
  language: "system",
  contentLanguage: "system",

  defaultProvider: "anthropic",
  defaultModel: "",
  // 2026-10-24 갱신 — 제공자 목록 실측(OpenRouter /api/v1/models). Sonnet 5.5 는
  // Sonnet 5 와 같은 값($2/$10)에 새 판. GPT-6 Luna 는 4o-mini 보다 싸다($0.10/$0.50
  // vs $0.15/$0.60) — 샘플링을 거절하는 추론 계열이라 openai.rs `is_reasoning_model`
  // 이 온도를 뺀다. Gemini 는 Google 이 새 프로젝트에 권하는 3.8 Flash.
  modelAnthropic: "claude-sonnet-5-5",
  modelOpenai: "gpt-6-luna",
  modelGemini: "gemini-3.8-flash",
  // NVIDIA NIM default — generally-available, competitive open-weights model.
  // Users override per-project in Settings → LLM.
  modelNim: "meta/llama-3.3-70b-instruct",
  modelOpenrouter: "openai/gpt-6-luna",
  fallbackModels: "",
  // 미설정이 기본 — 신규 사용자에게는 게이트다 (D2). 기존 사용자는 프로젝트를
  // 열 때 백엔드가 대화 모델을 1회 시드한다.
  coreProvider: "",
  coreModel: "",
  coreModelSeeded: "",
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: "",

  chunkSize: 30,
  chunkOverlap: 4,
  ragTopK: 5,
  maxFileSizeKb: 500,
  excludePatterns: "",
  autoIndex: true,
  searchIncludeJournal: true,

  includeOculpmContext: true,
  oculpmContextEntries: 5,

  externalEditorCommand: 'code "%path"',


  lastSeenVersion: "",
  pluginCardDismissed: false,

  firstRunSheetDismissed: false,
};

const KEY_TO_FIELD: Record<string, keyof Settings> = {
  [KEYS.theme]: "theme",
  [KEYS.colorTheme]: "colorTheme",
  [KEYS.uiScale]: "uiScale",
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
  [KEYS.coreProvider]: "coreProvider",
  [KEYS.coreModel]: "coreModel",
  [KEYS.coreModelSeeded]: "coreModelSeeded",
  [KEYS.temperature]: "temperature",
  [KEYS.maxTokens]: "maxTokens",
  [KEYS.systemPrompt]: "systemPrompt",
  [KEYS.chunkSize]: "chunkSize",
  [KEYS.chunkOverlap]: "chunkOverlap",
  [KEYS.ragTopK]: "ragTopK",
  [KEYS.maxFileSizeKb]: "maxFileSizeKb",
  [KEYS.excludePatterns]: "excludePatterns",
  [KEYS.autoIndex]: "autoIndex",
  [KEYS.searchIncludeJournal]: "searchIncludeJournal",
  [KEYS.includeOculpmContext]: "includeOculpmContext",
  [KEYS.oculpmContextEntries]: "oculpmContextEntries",
  [KEYS.externalEditorCommand]: "externalEditorCommand",
  [KEYS.lastSeenVersion]: "lastSeenVersion",
  [KEYS.pluginCardDismissed]: "pluginCardDismissed",
  [KEYS.firstRunSheetDismissed]: "firstRunSheetDismissed",
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
  // 옛 프리셋 id(`nord` …)·`custom:<id>` 가 저장돼 있으면 시스템으로 읽는다 (4.0 에서 걷었다).
  if (field === "theme") return (raw === "light" || raw === "dark" ? raw : "system") as Settings[K];
  // string-typed
  return raw as Settings[K];
}

export function serialize<K extends keyof Settings>(_field: K, value: Settings[K]): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** 한 칸만 좁혀 쓰는 대입 헬퍼. `field` 를 제네릭으로 받아야 `coerce` 의
 *  `Settings[K]` 와 대입 대상의 타입이 짝이 맞는다 (`keyof Settings` 유니온
 *  그대로는 상관이 안 서서 예전에는 `any` 로 뚫었다). */
function assignField<K extends keyof Settings>(target: Settings, field: K, raw: string): void {
  target[field] = coerce(field, raw);
}

/// Convert the raw key/value entries returned by `settings_get_all` into a
/// fully-typed `Settings` object with defaults applied.
export function entriesToSettings(entries: Array<[string, string]>): Settings {
  const result: Settings = { ...DEFAULTS };
  for (const [k, v] of entries) {
    const field = KEY_TO_FIELD[k];
    if (!field) continue;
    assignField(result, field, v);
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

/**
 * 배경 작업이 실제로 부를 대상. `null` = Core Model 미설정 → 자동화는 성립
 * 불가다 (백엔드 `core_model::resolve` 와 **같은 판정** — 대화 모델로 조용히
 * 대체하지 않는다; 그러면 D2 게이트가 무의미해진다).
 */
export function coreModelTarget(
  settings: Settings
): { provider: Provider; model: string } | null {
  const provider = settings.coreProvider.trim();
  const model = settings.coreModel.trim();
  if (!provider || !model || !(PROVIDERS as string[]).includes(provider)) return null;
  return { provider: provider as Provider, model };
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
