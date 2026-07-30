import type { ITheme } from "@xterm/xterm";

// 터미널 팔레트를 앱 테마 토큰에서 파생한다 (2026-07-30).
//
// 예전엔 xterm 테마가 TerminalInstanceImpl 안의 TERM_THEME 상수 — 다크 한 벌이
// 박혀 있어 라이트/Solarized/Sepia 를 써도 터미널만 새까맣게 남았다. 이제 색의
// SSOT 는 tokens.css 의 `--term-*` 이고, 여기서는 그걸 읽어 ITheme 으로 옮기기만
// 한다. `data-theme` / `data-preset` / `data-accent` 는 모두 <html> 에 붙으므로
// 그 속성 변화만 관찰하면 테마 전환을 실시간으로 따라갈 수 있다.

/** ITheme 키 → CSS 변수명. 값은 tokens.css 가 라이트/다크 가족별로 정의한다. */
const VAR_BY_KEY = {
  background: "--term-bg",
  foreground: "--term-fg",
  cursor: "--term-cursor",
  cursorAccent: "--term-cursor-accent",
  selectionBackground: "--term-selection",
  black: "--term-black",
  red: "--term-red",
  green: "--term-green",
  yellow: "--term-yellow",
  blue: "--term-blue",
  magenta: "--term-magenta",
  cyan: "--term-cyan",
  white: "--term-white",
  brightBlack: "--term-bright-black",
  brightRed: "--term-bright-red",
  brightGreen: "--term-bright-green",
  brightYellow: "--term-bright-yellow",
  brightBlue: "--term-bright-blue",
  brightMagenta: "--term-bright-magenta",
  brightCyan: "--term-bright-cyan",
  brightWhite: "--term-bright-white",
} as const;

type ThemeKey = keyof typeof VAR_BY_KEY;

/** 토큰이 아직 안 붙은 순간(첫 페인트·jsdom 테스트)에도 쓸 수 있는 값 — 다크 기준. */
const FALLBACK: Record<ThemeKey, string> = {
  background: "#1b1f1d",
  foreground: "#f1f4f1",
  cursor: "#34d095",
  cursorAccent: "#1b1f1d",
  selectionBackground: "rgba(52,208,149,0.38)",
  black: "#1b201e",
  red: "#f1685f",
  green: "#34d095",
  yellow: "#e6c570",
  blue: "#6ea8fe",
  magenta: "#c79bf0",
  cyan: "#5fd5d0",
  white: "#d4d4d8",
  brightBlack: "#6e7670",
  brightRed: "#ff8079",
  brightGreen: "#4fdca0",
  brightYellow: "#f2d98a",
  brightBlue: "#8fc0ff",
  brightMagenta: "#d9b6f7",
  brightCyan: "#86e6e1",
  brightWhite: "#f4f4f6",
};

const THEME_ATTRS = ["data-theme", "data-preset", "data-accent"];

const HEX6 = /^#[0-9a-f]{6}$/i;

function readVar(root: HTMLElement, name: string): string {
  return getComputedStyle(root).getPropertyValue(name).trim();
}

/**
 * 현재 문서에 적용된 테마 토큰을 읽어 xterm ITheme 을 만든다.
 * `root` 는 테스트 주입용 — 기본은 <html>.
 */
export function readTerminalTheme(root: HTMLElement = document.documentElement): ITheme {
  const style = getComputedStyle(root);
  const theme = {} as Record<ThemeKey, string>;
  for (const key of Object.keys(VAR_BY_KEY) as ThemeKey[]) {
    theme[key] = style.getPropertyValue(VAR_BY_KEY[key]).trim() || FALLBACK[key];
  }
  return theme;
}

export interface SearchDecorationColors {
  matchBackground: string;
  matchOverviewRuler: string;
  activeMatchBackground: string;
  activeMatchColorOverviewRuler: string;
}

/**
 * 검색 하이라이트 색 — 액센트/노랑 계열에서 파생.
 * xterm 은 배경색에 #RRGGBB 만 받으므로 rgba/이름 토큰은 기본값으로 되돌린다.
 */
export function readSearchDecorations(
  root: HTMLElement = document.documentElement,
): SearchDecorationColors {
  const match = HEX6.test(readVar(root, "--term-yellow"))
    ? readVar(root, "--term-yellow")
    : FALLBACK.yellow;
  const active = HEX6.test(readVar(root, "--term-cursor"))
    ? readVar(root, "--term-cursor")
    : FALLBACK.cursor;
  return {
    matchBackground: match,
    matchOverviewRuler: match,
    activeMatchBackground: active,
    activeMatchColorOverviewRuler: active,
  };
}

/**
 * 테마 전환(<html> 의 data-theme/preset/accent)마다 `onChange` 를 부른다.
 * 반환값은 해제 함수.
 */
export function observeTerminalTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver((records) => {
    if (records.some((r) => r.attributeName && THEME_ATTRS.includes(r.attributeName))) onChange();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });
  return () => observer.disconnect();
}
