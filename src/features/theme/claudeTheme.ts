/**
 * Claude Code 테마 파일 — 앱의 터미널 색으로 만든 Claude Code 사용자 테마 (11-15, 계획
 * quality-round-20261115 {#claude-theme}).
 *
 * Claude Code 는 `~/.claude/themes/*.json` 을 사용자 테마로 읽고, 사용자가 Claude 안에서 `/theme` 으로
 * 고른다. 앱은 그 폴더의 `ocul.json` 하나만 쓴다(`claude_theme.rs`) — Claude 의 설정 파일은 건드리지
 * 않는다. 기본 테마의 주황 강조가 차분한 앱 터미널 위에서 따로 놀던 것을, 라이트 · 다크 모두 터미널과
 * 한 몸으로 보이게 한다.
 *
 * 영수증 규칙 1 로 칠한다: 예외(오류 · 경고 · 허락 기다림)만 앱의 의미색 계열 터미널 색, Claude 의 표시와
 * 고른 것은 앱 기본 강조색, 나머지(통과 포함)는 회색이다.
 *
 * 대비 바닥 — 글자 키는 바탕 위 4.5:1, 색 키(테두리 · 상태 표시)는 3:1. 못 넘으면 명도만 민다(라이트는
 * 검정 쪽, 다크는 흰색 쪽 · xterm `minimumContrastRatio` 와 같은 방식). 끝까지 밀어도 못 넘으면 그 키를
 * 빼서 Claude 기본값을 쓰게 한다.
 *
 * **창과 무관하게 만든다.** 파일은 하나인데 창은 여럿이고, 창마다 터미널 바탕(`--term-bg` = `--bg-content`,
 * 프로젝트 색이 스민다 · `projectTint.ts`)과 강조색(`--term-cursor` = `--accent`, 프로젝트 색 ·
 * `projectAccent.ts`)이 다르다. 그 둘을 창에서 읽으면 창마다 다른 파일이 나와 마지막에 테마가 바뀐 창이
 * 이긴다 — 바탕은 물들이기 전 값, 강조색은 설정의 강조색(`colorTheme`)을 아래 표에서 쓴다. 글자 · ANSI
 * 색은 가족만 따르므로 터미널 팔레트(`readTerminalTheme`)를 그대로 읽는다. 표는 `claude_theme.test.ts` 가
 * tokens.css 와 묶는다.
 */
import { useEffect } from "react";
import type { ITheme } from "@xterm/xterm";

import { claudeThemeApi } from "@/api/claudeSurface";
import { errorDetail } from "@/api/invoke";
import { luminance, parseColor, readTerminalTheme } from "@/features/terminal/termTheme";
import type { ClaudeTheme, ClaudeThemeOutcome } from "@/lib/bindings";
import { createStore } from "@/lib/createStore";
import type { ColorTheme, Settings } from "@/lib/settings";
import { followsSystem, type ThemeFamily } from "./apply";

/** `/theme` 목록에 보이는 이름. */
const NAME = "Ocul";

/** 물들이기 전 터미널 바탕 — tokens.css 의 `--bg-content`(`--term-bg` 가 가리키는 값). */
const TERM_BG: Record<ThemeFamily, string> = { light: "#faf9f5", dark: "#1b1f1d" };

/** 앱 기본 강조색 — tokens.css 의 `--accent`(`[data-accent]` 블록), 설정의 강조색 여섯 × 가족. */
const APP_ACCENT: Record<ThemeFamily, Record<ColorTheme, string>> = {
  light: { green: "#0e8a60", blue: "#2570e0", purple: "#7c5cdb", orange: "#e07b12", rose: "#e0524b", teal: "#0e9aa0" },
  dark: { green: "#34d095", blue: "#5b9bff", purple: "#a78bfa", orange: "#eaa23f", rose: "#f1685f", teal: "#5fd5d0" },
};

const TEXT_FLOOR = 4.5;
const HUE_FLOOR = 3;
/** 명도를 미는 칸 수 — 한 칸에 2%. */
const PUSH_STEPS = 50;

export interface ClaudeThemeInput {
  family: ThemeFamily;
  /** 터미널 팔레트 — 글자 · ANSI 색. `background` 는 물들이기 전 바탕이다(창과 무관). */
  term: ITheme;
  /** 앱 기본 강조색 — 프로젝트 색이 아니다. */
  accent: string;
}

/** 창과 무관한 입력 — 가족은 `<html data-theme>`(모든 창이 같다), 바탕 · 강조색은 표, 나머지는 터미널 팔레트. */
export function claudeThemeInput(colorTheme: string, root: HTMLElement = document.documentElement): ClaudeThemeInput {
  const family: ThemeFamily = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const accents = APP_ACCENT[family];
  return {
    family,
    term: { ...readTerminalTheme(root), background: TERM_BG[family] },
    accent: accents[colorTheme as ColorTheme] ?? accents.green,
  };
}

type Rgb = [number, number, number];

const ratio = (a: Rgb, b: Rgb): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** `a` 를 `t` 만큼 `b` 에 섞는다 (sRGB 선형 보간). 정수로 반올림한다 — 잰 값과 파일에 쓰는 값이 같게. */
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(b[i] + (a[i] - b[i]) * t)) as Rgb;
const toHex = (c: Rgb): string => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

/** 바닥을 넘을 때까지 명도만 민다 — 라이트는 검정 쪽, 다크는 흰색 쪽. 끝까지 밀어도 못 넘으면 `null`. */
function readable(c: Rgb, bg: Rgb, floor: number, family: ThemeFamily): Rgb | null {
  const end: Rgb = family === "light" ? [0, 0, 0] : [255, 255, 255];
  for (let step = 0; step <= PUSH_STEPS; step++) {
    const tried = mix(end, c, step / PUSH_STEPS);
    if (ratio(tried, bg) >= floor) return tried;
  }
  return null;
}

interface Palette {
  bg: Rgb;
  fg: Rgb;
  /** 흐린 글자 — 터미널의 bright-black(Claude 의 안내 글자가 터미널에서 받는 색). */
  dim: Rgb;
  /** 회색 라벨 — 글자와 흐린 글자의 가운데. */
  soft: Rgb;
  accent: Rgb;
  red: Rgb;
  yellow: Rgb;
  green: Rgb;
}

function paletteOf({ term, accent }: ClaudeThemeInput): Palette | null {
  const read = (c: string | undefined) => (c ? parseColor(c) : null);
  const [bg, fg, dim, red, yellow, green, acc] = [
    term.background,
    term.foreground,
    term.brightBlack,
    term.red,
    term.yellow,
    term.green,
    accent,
  ].map(read);
  if (!bg || !fg || !dim || !red || !yellow || !green || !acc) return null;
  return { bg, fg, dim, soft: mix(fg, dim, 0.5), accent: acc, red, yellow, green };
}

/** 글자는 바탕 위 4.5:1, 색(테두리 · 상태 표시)은 3:1, 면은 그 위의 글자가 4.5:1. */
export type ClaudeThemeRole = "text" | "hue" | "surface";

/** 흐르는 빛(생각 중 · 경고의 반짝임) — 같은 색을 글자 쪽으로 한 단. */
const shimmer = (p: Palette, c: Rgb) => mix(p.fg, c, 0.4);

/** Claude 의 색 키 → 역할 · 색. 키 이름은 Claude Code 테마의 이름 그대로다. */
const KEYS: ReadonlyArray<readonly [key: string, role: ClaudeThemeRole, color: (p: Palette) => Rgb]> = [
  // Claude 의 표시 — 스피너 · 로고 · 입력 칸 테두리. 앱 기본 강조색.
  ["claude", "hue", (p) => p.accent],
  ["claudeShimmer", "hue", (p) => shimmer(p, p.accent)],
  ["promptBorder", "hue", (p) => p.accent],
  ["promptBorderShimmer", "hue", (p) => shimmer(p, p.accent)],
  // 고른 것(자동 완성의 고른 줄) — 앱에서 고른 탭 · 포커스 테가 강조색인 것과 같다. 글자라 4.5.
  ["suggestion", "text", (p) => p.accent],
  // 예외 — 오류는 빨강, 경고와 허락 기다림은 노랑(앱의 「허락을 기다려요」 가 경고색이다).
  ["error", "hue", (p) => p.red],
  ["warning", "hue", (p) => p.yellow],
  ["warningShimmer", "hue", (p) => shimmer(p, p.yellow)],
  ["permission", "hue", (p) => p.yellow],
  ["permissionShimmer", "hue", (p) => shimmer(p, p.yellow)],
  // 나머지는 회색 — 통과도 회색이다(영수증 규칙 1, `.chip.ok`). 모드 표시는 낱말이 말한다.
  ["text", "text", (p) => p.fg],
  ["inactive", "text", (p) => p.dim],
  ["success", "text", (p) => p.soft],
  ["planMode", "text", (p) => p.soft],
  ["autoAccept", "text", (p) => p.soft],
  ["remember", "text", (p) => p.soft],
  ["ide", "text", (p) => p.soft],
  ["merged", "text", (p) => p.soft],
  ["bashBorder", "hue", (p) => p.soft],
  // 면 — 그 위에 글자가 얹힌다. diff 는 터미널의 초록 · 빨강을 바탕에 옅게(앱의 변경 화면처럼).
  ["userMessageBackground", "surface", (p) => mix(p.fg, p.bg, 0.07)],
  ["bashMessageBackgroundColor", "surface", (p) => mix(p.fg, p.bg, 0.07)],
  ["memoryBackgroundColor", "surface", (p) => mix(p.fg, p.bg, 0.07)],
  ["diffAdded", "surface", (p) => mix(p.green, p.bg, 0.16)],
  ["diffRemoved", "surface", (p) => mix(p.red, p.bg, 0.16)],
  ["diffAddedDimmed", "surface", (p) => mix(p.green, p.bg, 0.08)],
  ["diffRemovedDimmed", "surface", (p) => mix(p.red, p.bg, 0.08)],
  ["diffAddedWord", "surface", (p) => mix(p.green, p.bg, 0.32)],
  ["diffRemovedWord", "surface", (p) => mix(p.red, p.bg, 0.32)],
];

/** 키마다의 역할 — 시험이 바닥을 키별로 잰다. */
export const CLAUDE_THEME_ROLES: Readonly<Record<string, ClaudeThemeRole>> = Object.fromEntries(
  KEYS.map(([key, role]) => [key, role]),
);

/** 입력에서 Claude Code 테마를 만든다 (순수 — 같은 입력이면 같은 출력). */
export function claudeThemeFrom(input: ClaudeThemeInput): ClaudeTheme {
  const overrides: Record<string, string> = {};
  const theme: ClaudeTheme = { name: NAME, base: input.family, overrides };
  const p = paletteOf(input);
  // 팔레트를 못 읽으면 덮지 않는다 — Claude 의 내장 테마 그대로가 엉뚱한 색보다 낫다.
  if (!p) return theme;
  const ink = readable(p.fg, p.bg, TEXT_FLOOR, input.family) ?? p.fg;
  for (const [key, role, color] of KEYS) {
    const want = color(p);
    const got =
      role === "surface"
        ? ratio(ink, want) >= TEXT_FLOOR
          ? want
          : null
        : readable(want, p.bg, role === "text" ? TEXT_FLOOR : HUE_FLOOR, input.family);
    if (got) overrides[key] = toHex(got);
  }
  return theme;
}

/** 이 창이 마지막으로 맞춘 결과 — 설정의 줄이 읽는다. `idle` 은 아직 맞추지 않았다. */
export type ClaudeThemeStatus =
  | { kind: "idle" }
  | { kind: "done"; outcome: ClaudeThemeOutcome | null }
  | { kind: "failed"; error: string };

export const claudeThemeStatus = createStore<ClaudeThemeStatus>({ kind: "idle" });

let latest = 0;

/** 지금 앱 테마로 파일을 맞춘다 — 같은 내용이면 백엔드가 쓰지 않는다. 늦게 온 옛 응답은 버린다. */
export async function syncClaudeTheme(colorTheme: string, root?: HTMLElement): Promise<void> {
  const mine = ++latest;
  let next: ClaudeThemeStatus;
  try {
    next = { kind: "done", outcome: await claudeThemeApi.write(claudeThemeFrom(claudeThemeInput(colorTheme, root))) };
  } catch (e) {
    next = { kind: "failed", error: errorDetail(e) };
  }
  if (mine === latest) claudeThemeStatus.set(next);
}

/** 모양을 연달아 바꾸거나 OS 가 전환 중에 여러 번 알려도 한 번만 쓴다. */
const SETTLE_MS = 300;

/**
 * 앱 테마(라이트 · 다크 · 시스템 전환 · 강조색)가 바뀌면 300ms 뒤에 파일을 맞춘다. 끄면 아무것도 하지 않는다 —
 * 이미 있는 파일도 그대로 둔다. `SettingsContext` 가 창마다 부른다: 창 여럿이 같은 내용을 보내도 백엔드가 쓰지 않는다.
 */
export function useClaudeThemeSync(
  settings: Pick<Settings, "theme" | "colorTheme" | "claudeTheme">,
  loaded: boolean,
): void {
  const { theme, colorTheme, claudeTheme } = settings;
  useEffect(() => {
    if (!loaded || claudeTheme === "off") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncClaudeTheme(colorTheme), SETTLE_MS);
    };
    schedule();
    // 「시스템」 이면 OS 의 밝기 전환도 따라간다 — 가족은 `<html data-theme>` 에서 읽으니 그것이 바뀐 뒤에.
    const mq = followsSystem(theme) ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
    mq?.addEventListener?.("change", schedule);
    return () => {
      clearTimeout(timer);
      mq?.removeEventListener?.("change", schedule);
    };
  }, [loaded, theme, colorTheme, claudeTheme]);
}
