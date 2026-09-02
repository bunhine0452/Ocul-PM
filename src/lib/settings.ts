// Centralized app settings registry. All keys, defaults, and types live here.
// Settings are persisted in the SQLite `settings` table via Tauri commands.

import type { LangSetting } from "@/i18n";
import { TERM_FONT_DEFAULT } from "@/features/terminal/fontSize";
import { TERM_DENSITY_DEFAULT, type TermDensity } from "@/features/terminal/density";

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

/** 자동 저장 방식 — `src/features/code/autoSave.ts` 가 해석한다. */
export type AutoSaveMode = "off" | "afterDelay" | "onFocusChange";
export const AUTO_SAVE_MODES: AutoSaveMode[] = ["off", "afterDelay", "onFocusChange"];

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
  // 터미널 밀도 프리셋(줄 높이·페인 여백). 글자 크기와 다른 축이라 따로 산다
  // — 크기는 "읽히는가", 밀도는 "숨 쉴 자리가 있는가" 다.
  terminalDensity: "terminal_density",
  // 세로 세션 레일을 아이콘만 남기고 접었는가.
  terminalRailCollapsed: "terminal_rail_collapsed",
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

  // --- AI 작업 맥락 (oculpm 기록 주입) ---
  includeOculpmContext: "include_oculpm_context",
  oculpmContextEntries: "oculpm_context_entries",

  // --- Dependency graph ---
  graphShowIsolated: "graph_show_isolated",
  graphGroupThreshold: "graph_group_threshold",

  // --- External editor (Lite-W6 PR8 Part 2) ---
  externalEditorCommand: "external_editor_command",

  // --- 코드 화면 (ide-completion Phase 2) ---
  codeFormatOnSave: "code_format_on_save",
  codeTabSize: "code_tab_size",
  codeInsertSpaces: "code_insert_spaces",
  // --- 저장 위생 (vscode-borrows B1·B2) ---
  codeTrimTrailingWhitespace: "code_trim_trailing_whitespace",
  codeInsertFinalNewline: "code_insert_final_newline",
  codeTrimFinalNewlines: "code_trim_final_newlines",
  codeAutoSave: "code_auto_save",
  codeAutoSaveDelay: "code_auto_save_delay",
  codePreviewTabs: "code_preview_tabs",
  codeStickyScroll: "code_sticky_scroll",
  codeStickyMaxLines: "code_sticky_max_lines",
  codeLocalHistory: "code_local_history",
  codeLocalHistoryMaxEntries: "code_local_history_max_entries",

  // --- 첫 실행 ---
  // 첫 실행 마법사(언어·모양·첫 프로젝트)를 끝냈거나 건너뛰었는가.
  // false 인 **동시에** 등록된 프로젝트가 0개일 때만 마법사가 뜬다 — 이미
  // 쓰고 있던 사용자가 업데이트 후에 다시 안내를 받으면 안 되기 때문이다.
  onboarded: "onboarded",

  // --- 업데이트 ---
  // 마지막으로 What's-new 카드를 본 앱 버전. 앱 버전이 이보다 새로우면 Today 가
  // 한 번 릴리스 노트를 보여 준다. 빈 문자열 = 아직 한 번도 기록 안 함(첫 설치).
  lastSeenVersion: "last_seen_version",

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
  /**
   * 터미널 밀도 프리셋. 값·줄 높이·여백은 `@/features/terminal/density`.
   * 모르는 문자열이 들어와도 읽는 쪽이 `clampTermDensity` 로 되돌린다.
   */
  terminalDensity: TermDensity;
  /** 세로 세션 레일을 접어 아이콘만 남긴다 (좁은 도크에서 자리를 아낀다). */
  terminalRailCollapsed: boolean;
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

  /**
   * 저장할 때 언어 서버로 포맷한다 (⇧⌥F 를 매번 누르지 않게).
   *
   * 기본 **꺼짐**: 에이전트가 활발히 고치는 파일에서 저장이 조용히 파일 전체를
   * 다시 쓰면, 사용자가 만들지 않은 변경이 diff 를 덮는다. 켤지는 사용자가 정한다.
   */
  codeFormatOnSave: boolean;
  /** 포맷 요청에 실어 보내는 들여쓰기 폭 (LSP `FormattingOptions.tabSize`). */
  codeTabSize: number;
  /** 탭 대신 공백 (LSP `FormattingOptions.insertSpaces`). */
  codeInsertSpaces: boolean;

  /**
   * 저장할 때 각 줄 끝의 공백을 지운다.
   *
   * 기본 **꺼짐**: 후행 공백이 흔한 파일을 처음 저장하면 파일 전체가 한 번
   * 바뀐다. diff 가 제품인 앱에서 그 노이즈는 사용자가 골라야 한다.
   * (`.md`·`.markdown` 은 줄 끝 두 칸이 강제 개행이라 켜도 빠진다.)
   */
  codeTrimTrailingWhitespace: boolean;
  /** 저장할 때 파일이 개행으로 끝나게 한다. */
  codeInsertFinalNewline: boolean;
  /** 저장할 때 끝의 빈 줄을 하나만 남긴다. */
  codeTrimFinalNewlines: boolean;
  /**
   * 자동 저장. 기본 꺼짐.
   *
   * 이 앱에서는 편의가 아니라 **정합성**이다: 사용자가 저장을 잊고 에이전트에게
   * 파일을 맡기면 에이전트는 화면이 아니라 디스크를 읽는다.
   */
  codeAutoSave: AutoSaveMode;
  /** `afterDelay` 의 대기 시간(ms). 하한은 코드에서 250ms 로 강제한다. */
  codeAutoSaveDelay: number;
  /**
   * 트리에서 한 번 누른 파일을 **미리보기 탭**으로 연다 (기울임, 다음 미리보기가
   * 그 자리를 차지). 더블클릭·편집·창 이동이 고정으로 승격시킨다.
   *
   * 이 라운드에서 유일하게 기본 **켜짐**인 설정이다. 유지할 옛 동작이 "훑기만
   * 해도 탭이 계속 쌓인다" 이고, 그건 지킬 가치가 없다. 끄면 예전 그대로다.
   */
  codePreviewTabs: boolean;
  /**
   * 편집면 위에 지금 줄을 감싸는 상위 스코프를 겹쳐 고정한다 (스티키 스크롤).
   *
   * 기본 **꺼짐**: VS Code 기본은 켜짐이지만 우리 편집면은 분할·미리보기로
   * 이미 좁고, 맨 위 몇 줄을 늘 덮는 물건은 켤지 말지를 사용자가 골라야 한다.
   */
  codeStickyScroll: boolean;
  /** 겹쳐 고정할 최대 줄 수 (1–10). VS Code 와 같은 기본값 5. */
  codeStickyMaxLines: number;
  /**
   * 파일이 바뀔 때마다 그 시점 내용을 한 판 남긴다 (사람 저장·에이전트 쓰기 모두).
   *
   * 기본 **켜짐** — 이 라운드에서 유일한 예외다. **소급이 불가능**하기 때문이다:
   * 안 찍어 둔 판은 나중에 켜도 영원히 없다. 대신 캡이 작고(파일당 50판 ·
   * 판당 256KB), 저장 위치가 gitignore 안이며, "이 파일 판 지우기" 와
   * "전부 지우기" 를 준다.
   */
  codeLocalHistory: boolean;
  /** 파일당 남길 최대 판 수 (0 이면 사실상 끄기와 같다). VS Code 기본값 50. */
  codeLocalHistoryMaxEntries: number;

  /** What's-new 카드를 마지막으로 본 버전 (`""` = 기록 없음). */
  lastSeenVersion: string;

  /** 첫 실행 마법사를 끝냈거나 건너뛰었는가 (`false` = 아직 한 번도 안 봄). */
  onboarded: boolean;
}

export const DEFAULTS: Settings = {
  theme: "system",
  colorTheme: "green",
  uiScale: 1,
  terminalFontSize: TERM_FONT_DEFAULT,
  terminalDensity: TERM_DENSITY_DEFAULT,
  terminalRailCollapsed: false,
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

  includeOculpmContext: true,
  oculpmContextEntries: 5,

  graphShowIsolated: false,
  graphGroupThreshold: 3,

  externalEditorCommand: 'code "%path"',

  codeFormatOnSave: false,
  codeTabSize: 2,
  codeInsertSpaces: true,
  codeTrimTrailingWhitespace: false,
  codeInsertFinalNewline: false,
  codeTrimFinalNewlines: false,
  codeAutoSave: "off",
  codeAutoSaveDelay: 1000,
  codePreviewTabs: true,
  codeStickyScroll: false,
  codeStickyMaxLines: 5,
  codeLocalHistory: true,
  codeLocalHistoryMaxEntries: 50,

  lastSeenVersion: "",

  onboarded: false,
};

const KEY_TO_FIELD: Record<string, keyof Settings> = {
  [KEYS.theme]: "theme",
  [KEYS.colorTheme]: "colorTheme",
  [KEYS.uiScale]: "uiScale",
  [KEYS.terminalFontSize]: "terminalFontSize",
  [KEYS.terminalDensity]: "terminalDensity",
  [KEYS.terminalRailCollapsed]: "terminalRailCollapsed",
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
  [KEYS.includeOculpmContext]: "includeOculpmContext",
  [KEYS.oculpmContextEntries]: "oculpmContextEntries",
  [KEYS.graphShowIsolated]: "graphShowIsolated",
  [KEYS.graphGroupThreshold]: "graphGroupThreshold",
  [KEYS.externalEditorCommand]: "externalEditorCommand",
  [KEYS.codeFormatOnSave]: "codeFormatOnSave",
  [KEYS.codeTabSize]: "codeTabSize",
  [KEYS.codeInsertSpaces]: "codeInsertSpaces",
  [KEYS.codeTrimTrailingWhitespace]: "codeTrimTrailingWhitespace",
  [KEYS.codeInsertFinalNewline]: "codeInsertFinalNewline",
  [KEYS.codeTrimFinalNewlines]: "codeTrimFinalNewlines",
  [KEYS.codeAutoSave]: "codeAutoSave",
  [KEYS.codeAutoSaveDelay]: "codeAutoSaveDelay",
  [KEYS.codePreviewTabs]: "codePreviewTabs",
  [KEYS.codeStickyScroll]: "codeStickyScroll",
  [KEYS.codeStickyMaxLines]: "codeStickyMaxLines",
  [KEYS.codeLocalHistory]: "codeLocalHistory",
  [KEYS.codeLocalHistoryMaxEntries]: "codeLocalHistoryMaxEntries",
  [KEYS.lastSeenVersion]: "lastSeenVersion",
  [KEYS.onboarded]: "onboarded",
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
