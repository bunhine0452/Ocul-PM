// Centralized app settings registry. All keys, defaults, and types live here.
// Settings are persisted in the SQLite `settings` table via Tauri commands.

import type { LangSetting } from "@/i18n";

/** 밝게 / 어둡게 / 시스템. (옛 프리셋 id·`custom:<id>` 가 저장돼 있으면 `"system"` 으로 읽는다.) */
export type Theme = "light" | "dark" | "system";
/** Accent color palette, applied via `[data-accent]` over light/dark tokens. */
export type ColorTheme = "green" | "blue" | "purple" | "orange" | "rose" | "teal";

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

  // --- External editor (Lite-W6 PR8 Part 2) ---
  // DB 에 남은 걷은 기능의 키는 읽지 않는다 — `entriesToSettings` 가 모르는 키를 건너뛴다.
  externalEditorCommand: "external_editor_command",
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
  language: "system",
  contentLanguage: "system",

  externalEditorCommand: 'code "%path"',
};

const KEY_TO_FIELD: Record<string, keyof Settings> = {
  [KEYS.theme]: "theme",
  [KEYS.colorTheme]: "colorTheme",
  [KEYS.uiScale]: "uiScale",
  [KEYS.language]: "language",
  [KEYS.contentLanguage]: "contentLanguage",
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

