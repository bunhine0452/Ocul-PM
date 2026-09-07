/**
 * 테마 스키마 v1 — 프런트 쪽 계약 (Osaurus 라운드 Phase 4 `#theme-schema`).
 *
 * 타입 정본은 생성된 `bindings.ts` 다 (`ThemeFile` / `ThemeMetadata`). 여기
 * 있는 것은 **편집기가 필요로 하는 것**뿐이다: 다섯 그룹으로 묶은 토큰 목록과
 * 그 라벨 키.
 *
 * 검증(화이트리스트·색 값)은 백엔드가 소유한다 — 신뢰 경계가 거기다. 이 파일의
 * 목록이 백엔드 `ALLOWED_TOKENS` 와 어긋나면 `theme_schema.test.ts` 가 막는다.
 */
import type { I18nKey } from "@/i18n";
import type { ThemeFile } from "@/lib/bindings";

export type ThemeFamily = "light" | "dark";

/**
 * 편집기 섹션 = 토큰 그룹. 설계 §4 의 다섯 묶음 + 문법색 하나
 * (`{#code-color-editor}`).
 */
export interface TokenGroup {
  id: "surface" | "text" | "accent" | "line" | "status" | "code";
  titleKey: I18nKey;
  tokens: readonly string[];
  /**
   * 토큰별 「사람이 읽는 이름」 — 이름만으로는 뜻이 안 서는 그룹에만 붙인다.
   * `--bg-window` 는 읽으면 알지만 `--code-kw` 는 아니다. 없으면 편집기가
   * 지금까지처럼 토큰 이름만 보여 준다.
   */
  labelKeys?: Readonly<Record<string, I18nKey>>;
}

/**
 * 문법 강조 색 열 개 (`tokens.css` {#hljs-unify}) — 코드 화면·변경 diff 의
 * 강조가 이 열 개만 본다 (`features/code/CodeEditor.tsx` 의 하이라이트 표).
 *
 * 3차 라운드가 화이트리스트 **양쪽**(여기와 `themes/mod.rs`)에 넣어 내려받은
 * 커스텀 테마가 값을 실을 수 있게 했고, 이번 라운드({#code-color-editor})가
 * 나머지 절반 — 앱에서 점 찍어 고르는 편집기 섹션 — 을 붙였다. 그래서 지금은
 * 다른 다섯 묶음과 똑같이 `TOKEN_GROUPS` 의 한 그룹이다.
 */
export const CODE_TOKENS: readonly string[] = [
  "--code-fg",
  "--code-kw",
  "--code-str",
  "--code-comment",
  "--code-num",
  "--code-fn",
  "--code-type",
  "--code-prop",
  "--code-def",
  "--code-op",
];

/** 문법색 토큰의 사람이 읽는 이름. `CODE_TOKENS` 전부를 덮어야 한다 (테스트가 문다). */
const CODE_TOKEN_LABELS: Readonly<Record<string, I18nKey>> = {
  "--code-fg": "theme.token.codeFg",
  "--code-kw": "theme.token.codeKw",
  "--code-str": "theme.token.codeStr",
  "--code-comment": "theme.token.codeComment",
  "--code-num": "theme.token.codeNum",
  "--code-fn": "theme.token.codeFn",
  "--code-type": "theme.token.codeType",
  "--code-prop": "theme.token.codeProp",
  "--code-def": "theme.token.codeDef",
  "--code-op": "theme.token.codeOp",
};

export const TOKEN_GROUPS: readonly TokenGroup[] = [
  {
    id: "surface",
    titleKey: "theme.group.surface",
    tokens: [
      "--bg-window",
      "--bg-sidebar",
      "--bg-content",
      "--bg-card",
      "--bg-inset",
      "--bg-hover",
      "--bg-active",
    ],
  },
  {
    id: "text",
    titleKey: "theme.group.text",
    tokens: ["--text", "--text-2", "--text-3", "--text-on-accent"],
  },
  {
    id: "accent",
    titleKey: "theme.group.accent",
    tokens: ["--accent", "--accent-strong", "--accent-text", "--accent-soft", "--accent-ring"],
  },
  {
    id: "line",
    titleKey: "theme.group.line",
    tokens: ["--sep", "--sep-strong", "--border-card"],
  },
  {
    id: "status",
    titleKey: "theme.group.status",
    tokens: [
      "--ok",
      "--ok-text",
      "--ok-soft",
      "--warn",
      "--warn-text",
      "--warn-soft",
      "--danger",
      "--danger-text",
      "--danger-soft",
      "--info",
      "--info-text",
      "--info-soft",
    ],
  },
  {
    id: "code",
    titleKey: "theme.group.code",
    tokens: CODE_TOKENS,
    labelKeys: CODE_TOKEN_LABELS,
  },
] as const;

/** 화이트리스트 — 그룹을 펼친 것. 밖의 키는 백엔드가 임포트에서 거부한다. */
export const ALLOWED_TOKENS: readonly string[] = TOKEN_GROUPS.flatMap((g) => g.tokens);

/**
 * 테마가 강조를 **소유**했는지 판정할 때 보는 다섯 토큰.
 *
 * 하나도 지정하지 않으면 사용자가 고른 `data-accent` 를 유지한다 — 배경만 바꾼
 * 테마를 골랐다는 이유로 강조색 선택이 조용히 사라지면 안 된다 (설계 §2).
 */
export const ACCENT_TOKENS: readonly string[] = [
  "--accent",
  "--accent-strong",
  "--accent-text",
  "--accent-soft",
  "--accent-ring",
];

/** 테마가 강조 토큰을 하나라도 지정했나 (`follows_system_accent` 도 소유로 본다). */
export function ownsAccent(theme: Pick<ThemeFile, "tokens" | "follows_system_accent">): boolean {
  if (theme.follows_system_accent) return true;
  const tokens = theme.tokens ?? {};
  return ACCENT_TOKENS.some((k) => tokens[k] != null);
}

/**
 * 토큰 맵 — 없으면 빈 객체.
 *
 * 생성된 타입에서 `tokens` 가 optional 인 이유는 **부분 지정이 정상**이라
 * 백엔드가 `#[serde(default)]` 를 달았기 때문이다 (강조색만 바꾼 테마 파일이
 * 다섯 줄로 성립해야 한다). 화면은 이 함수를 지나 항상 맵을 본다.
 */
export function themeTokens(theme: Pick<ThemeFile, "tokens">): Record<string, string> {
  return theme.tokens ?? {};
}

/** 빈 사용자 테마 한 벌 — "새 테마" 와 "복제해서 편집" 이 함께 쓴다. */
export function blankTheme(name: string, family: ThemeFamily): ThemeFile {
  return {
    oculpm_theme: "v1",
    metadata: { id: "", name, version: "1.0", author: null, created_at: "", updated_at: "" },
    family,
    is_built_in: false,
    follows_system_accent: false,
    tokens: {},
  };
}

/** 내장 테마를 사용자 테마로 복제한다 — id 를 비워 저장 시 새 UUID 를 받게. */
export function duplicateTheme(source: ThemeFile, name: string): ThemeFile {
  return {
    ...source,
    metadata: { ...source.metadata, id: "", name, created_at: "", updated_at: "" },
    is_built_in: false,
    tokens: { ...source.tokens },
  };
}
