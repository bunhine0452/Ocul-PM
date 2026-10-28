/**
 * 테마 적용 — 밝게 / 어둡게 / 시스템, 그리고 강조색.
 *
 * `<html>` 에는 `data-theme`(가족: light | dark) 와 `data-accent`(강조 팔레트) 두 속성만
 * 단다. 프리셋(Solarized·Nord …)·사용자 테마 파일·프로젝트별 테마는 4.0 에서 걷었다 —
 * 저장된 옛 값(`"nord"`, `"custom:<id>"` …)은 조용히 `"system"` 으로 읽는다.
 *
 * 이 모듈은 **순수**하다. DOM 을 만지는 것은 [`applyThemeAttrs`] 하나뿐이고,
 * 무엇을 만질지는 [`resolveThemeAttrs`] 가 계산한다 (테스트가 그걸 본다).
 */

export type ThemeFamily = "light" | "dark";

export interface ThemeAttrs {
  family: ThemeFamily;
  /** `data-accent` 값 (설정의 `colorTheme`). */
  accent: string;
}

export interface ThemeInput {
  /** 설정의 `theme` 값. 알 수 없는 값(옛 프리셋 id 등)은 `"system"` 으로 읽는다. */
  themeSetting: string;
  /** 설정의 `colorTheme`(`data-accent`). */
  colorTheme: string;
  /** OS 가 다크를 선호하나 — `"system"` 일 때만 본다. */
  prefersDark: boolean;
}

/** 설정 → `<html>` 에 달 것들. */
export function resolveThemeAttrs(input: ThemeInput): ThemeAttrs {
  const value = input.themeSetting;
  const family: ThemeFamily =
    value === "dark" ? "dark" : value === "light" ? "light" : input.prefersDark ? "dark" : "light";
  return { family, accent: input.colorTheme };
}

/** 이 설정 값이 OS 를 따라가는가 — 알 수 없는 옛 값도 포함한다. */
export function followsSystem(themeSetting: string): boolean {
  return themeSetting !== "light" && themeSetting !== "dark";
}

/** 계산한 속성을 실제 `<html>` 에 적용한다. */
export function applyThemeAttrs(root: HTMLElement, attrs: ThemeAttrs): void {
  root.setAttribute("data-theme", attrs.family);
  root.setAttribute("data-accent", attrs.accent);
}
