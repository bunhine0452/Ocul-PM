import type { ITheme } from "@xterm/xterm";

// 터미널 팔레트를 앱 테마 토큰에서 파생한다 (2026-07-30, 4.0 터미널 복귀 때 되살림).
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
  brightBlack: "#858d87",
  brightRed: "#ff8079",
  brightGreen: "#4fdca0",
  brightYellow: "#f2d98a",
  brightBlue: "#8fc0ff",
  brightMagenta: "#d9b6f7",
  brightCyan: "#86e6e1",
  brightWhite: "#f4f4f6",
};

// `data-tint` — 프로젝트 색이 바탕에 스민다(`projectTint.ts`). 강조색이 같아도 바탕은 바뀐다.
const THEME_ATTRS = ["data-theme", "data-preset", "data-accent", "data-tint"];

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

/** `#rgb` · `#rrggbb` · `rgb(r, g, b)` → [0..255] 셋. 못 읽으면 `null`. (Claude 테마 파일도 쓴다 — `claudeTheme.ts`.) */
export function parseColor(color: string): [number, number, number] | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((h) => h + h).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** WCAG 상대 휘도(0 검정 ~ 1 흰색). */
export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * 글자 대비의 바닥(xterm `minimumContrastRatio`) — 밝은 바탕은 4.5:1(본문 글자 기준), 어두운 바탕은 3:1.
 * 1.5 였을 때는 흐린 회색(bright-black, Claude Code 의 안내 글자)이 라이트 3.78:1 · 다크 3.56:1 로 보정 없이
 * 그려졌다. 어두운 바탕을 4.5 로 올리면 프로그램이 일부러 낮춘 색까지 밝아져 위계가 무너진다 — 3 에서 멈춘다.
 */
export function contrastFloor(background: string | undefined): number {
  const rgb = background ? parseColor(background) : null;
  return rgb && luminance(rgb) > 0.5 ? 4.5 : 3;
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
