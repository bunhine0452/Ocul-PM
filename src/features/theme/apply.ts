/**
 * 테마 적용 (Phase 4 `#theme-apply`).
 *
 * 지금까지 `SettingsContext` 는 `data-theme`(가족) · `data-preset`(내장 프리셋) ·
 * `data-accent`(강조 팔레트) 세 속성만 달았다. 커스텀 테마는 여기에 **인라인
 * CSS 변수**를 얹는다:
 *
 *     <html data-theme="dark" data-preset="custom" style="--bg-window:#141416; …">
 *
 * 인라인 변수는 명시도 최상위라 어떤 블록도 이긴다 — 그래서 "부분 지정한
 * 토큰만 덮고 나머지는 가족 기본값을 상속" 이 자연스럽게 성립한다.
 * `data-preset="custom"` 은 내장 프리셋 규칙과 충돌하지 않게 하는 표식일 뿐이다.
 *
 * 이 모듈은 **순수**하다. DOM 을 만지는 것은 [`applyThemeAttrs`] 하나뿐이고,
 * 무엇을 만질지는 [`resolveThemeAttrs`] 가 계산한다 (테스트가 그걸 본다).
 */
import type { ThemeFile } from "@/lib/bindings";

import { deriveAccentTokens } from "./accent";
import { BUILTIN_BY_ID } from "./builtins";
import { ALLOWED_TOKENS, ownsAccent, type ThemeFamily } from "./schema";

/** 커스텀 테마의 설정값 접두 — `theme` 설정과 프로젝트 바인딩이 같이 쓴다. */
export const CUSTOM_PREFIX = "custom:";

export interface ThemeAttrs {
  family: ThemeFamily;
  /** `data-preset` 값 — 내장 id · `"custom"` · 없음. */
  preset: string | null;
  /** `data-accent` 값 — 테마가 강조를 소유하지 않을 때만. */
  accent: string | null;
  /** 인라인 CSS 변수 (부분 지정). */
  vars: Record<string, string>;
  /** 실제로 적용된 테마 값 — 폴백이 일어났는지 부르는 쪽이 알 수 있게. */
  resolved: string;
}

export interface ThemeInput {
  /** 설정의 `theme` 값, 또는 프로젝트 바인딩이 이긴 값. */
  themeSetting: string;
  /** 설정의 `colorTheme`(`data-accent`). */
  colorTheme: string;
  /** 사용자가 만든 테마 (`theme_list`). */
  customThemes: readonly ThemeFile[];
  /** macOS 시스템 강조색 hex. 없으면 `follows_system_accent` 는 무시된다. */
  systemAccent: string | null;
  /** OS 가 다크를 선호하나 — `"system"` 일 때만 본다. */
  prefersDark: boolean;
  /**
   * 편집 중인 초안. 있으면 **이것이 이긴다** — 앱 자체가 미리보기이므로
   * (설계 §4), 저장하면 보게 될 화면을 저장 전에 그대로 보여 준다.
   */
  draft?: ThemeFile | null;
}

/** 커스텀 테마 값(`custom:<id>`)이면 id, 아니면 `null`. */
export function customIdOf(value: string): string | null {
  return value.startsWith(CUSTOM_PREFIX) ? value.slice(CUSTOM_PREFIX.length) : null;
}

/** 테마 하나 → 속성 한 벌. 내장·커스텀이 같은 문을 지난다. */
function fromTheme(theme: ThemeFile, input: ThemeInput, preset: string, resolved: string): ThemeAttrs {
  const family = theme.family === "dark" ? "dark" : "light";
  const vars: Record<string, string> = { ...theme.tokens };
  if (theme.follows_system_accent && input.systemAccent) {
    Object.assign(vars, deriveAccentTokens(input.systemAccent, family));
  }
  return {
    family,
    preset,
    // 강조를 하나도 지정하지 않은 테마는 사용자가 고른 강조색을 **유지**한다.
    accent: ownsAccent(theme) ? null : input.colorTheme,
    vars,
    resolved,
  };
}

/**
 * 설정 + 테마 목록 → `<html>` 에 달 것들.
 *
 * 폴백 규칙: 가리키는 커스텀 테마가 사라졌으면 조용히 `"system"` 으로 떨어진다
 * (지운 테마를 쓰던 프로젝트가 흰 화면이 되면 안 된다).
 */
export function resolveThemeAttrs(input: ThemeInput): ThemeAttrs {
  if (input.draft) {
    return fromTheme(input.draft, input, "custom", "draft");
  }

  const value = input.themeSetting || "system";

  const customId = customIdOf(value);
  if (customId) {
    const found = input.customThemes.find((t) => t.metadata.id === customId);
    if (found) return fromTheme(found, input, "custom", value);
    return resolveThemeAttrs({ ...input, themeSetting: "system" });
  }

  const builtin = BUILTIN_BY_ID[value];
  if (builtin) {
    // 내장은 `tokens.css` 의 `[data-preset]` 블록이 이미 칠한다 — 같은 값을
    // 인라인으로 또 얹지 않는다 (한 벌만 존재해야 어긋날 일이 없다).
    return { ...fromTheme(builtin, input, value, value), vars: {} };
  }

  const family: ThemeFamily =
    value === "dark" ? "dark" : value === "light" ? "light" : input.prefersDark ? "dark" : "light";
  return { family, preset: null, accent: input.colorTheme, vars: {}, resolved: value };
}

/**
 * 이 테마 값이 강조를 소유하나 — 강조색 선택기를 잠글지의 판정.
 *
 * 「테마가 프리셋이면 잠근다」로 두면 틀린다: 배경만 바꾼 커스텀 테마는 강조를
 * 소유하지 않으므로 사용자가 고른 강조색이 그대로 살아 있고, 그러면 선택기도
 * 살아 있어야 한다 (적용 규칙과 같은 판정을 써야 화면과 결과가 어긋나지 않는다).
 */
export function themeOwnsAccent(
  themeSetting: string,
  customThemes: readonly ThemeFile[],
): boolean {
  const customId = customIdOf(themeSetting);
  if (customId) {
    const found = customThemes.find((t) => t.metadata.id === customId);
    return found ? ownsAccent(found) : false;
  }
  return BUILTIN_BY_ID[themeSetting] != null;
}

/**
 * 계산한 속성을 실제 `<html>` 에 적용한다.
 *
 * 인라인 변수는 **매번 화이트리스트 전체를 지우고** 새로 얹는다. 이전에 무엇을
 * 얹었는지 기억하지 않아도 되므로(테마를 갈아탈 때 옛 토큰이 남는 종류의 버그가
 * 구조적으로 없다) 31번의 removeProperty 를 감수할 값어치가 있다.
 */
export function applyThemeAttrs(root: HTMLElement, attrs: ThemeAttrs): void {
  root.setAttribute("data-theme", attrs.family);
  if (attrs.preset) root.setAttribute("data-preset", attrs.preset);
  else root.removeAttribute("data-preset");
  if (attrs.accent) root.setAttribute("data-accent", attrs.accent);
  else root.removeAttribute("data-accent");

  for (const token of ALLOWED_TOKENS) root.style.removeProperty(token);
  for (const [token, value] of Object.entries(attrs.vars)) {
    if (!ALLOWED_TOKENS.includes(token)) continue; // 백엔드가 이미 걸렀지만 한 번 더.
    root.style.setProperty(token, value);
  }
}
