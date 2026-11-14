/**
 * Claude Code 테마 파일 (11-15 #claude-theme, X-04) — tokens.css 를 읽어 만든 라이트 · 다크 터미널 팔레트에서
 * 만든 테마의 글자 키는 바탕 위 4.5:1, 색 키는 3:1, 면 위의 글자도 4.5:1, base 는 그 가족, 같은 입력이면 같은
 * 출력이다. 바닥을 못 넘는 색은 명도만 밀고, 끝까지 밀어도 못 넘으면 키를 뺀다.
 *
 * 파일은 하나인데 창은 여럿이다 — 프로젝트 색이 다른 두 창(물든 바탕 · 프로젝트 강조색)이 같은 바이트를 낸다.
 * 그래서 바탕 · 강조색은 창이 아니라 표에서 오고, 그 표는 tokens.css 와 같아야 한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ITheme } from "@xterm/xterm";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLAUDE_THEME_ROLES,
  claudeThemeFrom,
  claudeThemeInput,
  type ClaudeThemeInput,
} from "@/features/theme/claudeTheme";

const css = readFileSync(join(__dirname, "..", "styles", "tokens.css"), "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`tokens.css has no ${selector} block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

type Family = "light" | "dark";
const DARK = '[data-theme="dark"]';
const FAMILY: Record<Family, Map<string, string>> = {
  light: block(":root"),
  dark: new Map([...block(":root"), ...block(DARK)]),
};

function resolve(fam: Map<string, string>, name: string): string {
  let v = fam.get(name) ?? "";
  for (let i = 0; i < 5 && v.startsWith("var("); i++) v = fam.get(/var\((--[\w-]+)/.exec(v)![1]) ?? "";
  return v;
}

/** `termTheme.ts` 의 ITheme 키 → 변수 — 물들이지 않은 창의 터미널 팔레트를 그대로 만든다. */
const TERM_VARS: Array<[keyof ITheme, string]> = [
  ["background", "--term-bg"],
  ["foreground", "--term-fg"],
  ["cursor", "--term-cursor"],
  ["black", "--term-black"],
  ["red", "--term-red"],
  ["green", "--term-green"],
  ["yellow", "--term-yellow"],
  ["blue", "--term-blue"],
  ["magenta", "--term-magenta"],
  ["cyan", "--term-cyan"],
  ["white", "--term-white"],
  ["brightBlack", "--term-bright-black"],
  ["brightRed", "--term-bright-red"],
  ["brightGreen", "--term-bright-green"],
  ["brightYellow", "--term-bright-yellow"],
  ["brightBlue", "--term-bright-blue"],
  ["brightMagenta", "--term-bright-magenta"],
  ["brightCyan", "--term-bright-cyan"],
  ["brightWhite", "--term-bright-white"],
];

const termOf = (family: Family): ITheme =>
  Object.fromEntries(TERM_VARS.map(([key, name]) => [key, resolve(FAMILY[family], name)])) as ITheme;

const inputOf = (family: Family): ClaudeThemeInput => ({
  family,
  term: termOf(family),
  accent: resolve(FAMILY[family], "--accent"),
});

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
// WCAG 2.x 상대 휘도 — `termTheme.ts` 의 luminance 와 같은 문턱(0.03928)이라 바닥에 붙은 값도 같게 잰다.
function lum([r, g, b]: Rgb): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(["light", "dark"] as const)("%s terminal", (family) => {
  const input = inputOf(family);
  const theme = claudeThemeFrom(input);
  const o = theme.overrides;
  const bg = input.term.background!;

  it("is named Ocul and sits on the matching base", () => {
    expect(theme.name).toBe("Ocul");
    expect(theme.base).toBe(family);
  });

  it("writes every key as #rrggbb, none dropped", () => {
    expect(Object.keys(o)).toEqual(Object.keys(CLAUDE_THEME_ROLES));
    for (const v of Object.values(o)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("text keys read at 4.5:1 on the background, colour keys at 3:1", () => {
    for (const [key, value] of Object.entries(o)) {
      const role = CLAUDE_THEME_ROLES[key];
      if (role === "text") expect(ratio(value, bg), key).toBeGreaterThanOrEqual(4.5);
      if (role === "hue") expect(ratio(value, bg), key).toBeGreaterThanOrEqual(3);
    }
  });

  it("text reads at 4.5:1 on every surface Claude paints", () => {
    const surfaces = Object.entries(o).filter(([key]) => CLAUDE_THEME_ROLES[key] === "surface");
    expect(surfaces.length).toBeGreaterThan(0);
    for (const [key, value] of surfaces) expect(ratio(o.text, value), key).toBeGreaterThanOrEqual(4.5);
  });

  // 영수증 규칙 1 — 색은 예외에만. 통과 · 모드 표시는 회색, Claude 의 표시는 앱 기본 강조색.
  it("colours only the exceptions: red errors, amber warnings and permission, grey success", () => {
    expect(o.claude).toBe(input.accent);
    expect(o.promptBorder).toBe(input.accent);
    expect(o.error).toBe(input.term.red);
    expect(o.warning).toBe(input.term.yellow);
    expect(o.permission).toBe(o.warning);
    expect(o.inactive).toBe(input.term.brightBlack);
    for (const key of ["success", "planMode", "autoAccept", "bashBorder"]) {
      const [r, g, b] = rgb(o[key]);
      expect(Math.max(r, g, b) - Math.min(r, g, b), key).toBeLessThanOrEqual(12);
      expect(o[key], key).toBe(o.success);
    }
  });

  it("gives the same bytes for the same input", () => {
    const again = claudeThemeFrom(structuredClone(input));
    expect(JSON.stringify(again)).toBe(JSON.stringify(theme));
  });
});

describe("the contrast floor", () => {
  it("pushes a colour that misses it toward black on light, keeping the key", () => {
    const pale = "#f0a030"; // 밝은 바탕 위 약 2:1
    const input = { ...inputOf("light"), accent: pale };
    expect(ratio(pale, input.term.background!)).toBeLessThan(3);
    const o = claudeThemeFrom(input).overrides;
    expect(o.claude).not.toBe(pale);
    expect(ratio(o.claude, input.term.background!)).toBeGreaterThanOrEqual(3);
    expect(lum(rgb(o.claude))).toBeLessThan(lum(rgb(pale)));
    // 고른 줄은 글자라 4.5 까지 더 민다.
    expect(ratio(o.suggestion, input.term.background!)).toBeGreaterThanOrEqual(4.5);
  });

  it("pushes toward white on dark", () => {
    const dim = "#3a5a4a";
    const input = { ...inputOf("dark"), accent: dim };
    const o = claudeThemeFrom(input).overrides;
    expect(ratio(o.claude, input.term.background!)).toBeGreaterThanOrEqual(3);
    expect(lum(rgb(o.claude))).toBeGreaterThan(lum(rgb(dim)));
  });

  it("drops a key it cannot fix, so Claude keeps its own colour there", () => {
    // 라이트 가족인데 바탕이 어둡다 — 검정 쪽으로 끝까지 밀어도 글자 바닥(4.5)에 못 닿는다.
    const input = { ...inputOf("light"), term: { ...termOf("light"), background: "#444444" } };
    const theme = claudeThemeFrom(input);
    expect(theme.base).toBe("light");
    expect(theme.overrides.text).toBeUndefined();
    expect(Object.keys(theme.overrides).length).toBeLessThan(Object.keys(CLAUDE_THEME_ROLES).length);
  });
});

describe("one file, many windows", () => {
  const made: HTMLElement[] = [];
  afterEach(() => {
    for (const el of made.splice(0)) el.remove();
  });

  /** 한 창의 `<html>` — 가족만 따르는 팔레트 위에, 창마다 다른 물든 바탕 · 프로젝트 강조색을 얹는다. */
  function windowRoot(family: Family, project?: { tint: string; accent: string; pc: string }): HTMLElement {
    const el = document.createElement("div");
    document.body.appendChild(el);
    made.push(el);
    el.setAttribute("data-theme", family);
    for (const [key, name] of TERM_VARS) el.style.setProperty(name, termOf(family)[key] as string);
    if (project) {
      el.setAttribute("data-tint", project.pc);
      el.setAttribute("data-accent", project.pc);
      el.style.setProperty("--term-bg", project.tint);
      el.style.setProperty("--term-cursor", project.accent);
    }
    return el;
  }

  it.each(["light", "dark"] as const)("%s: two windows with different project colours write the same bytes", (family) => {
    const bytes = (root: HTMLElement) => JSON.stringify(claudeThemeFrom(claudeThemeInput("green", root)));
    const plain = bytes(windowRoot(family));
    expect(bytes(windowRoot(family, { tint: "#1f2a32", accent: "#f1685f", pc: "rose" }))).toBe(plain);
    expect(bytes(windowRoot(family, { tint: "#e9eef6", accent: "#2f7fd8", pc: "blue" }))).toBe(plain);
  });

  it("reads the family from the window and follows the app accent setting, not the project colour", () => {
    const root = windowRoot("dark", { tint: "#1f2a32", accent: "#f1685f", pc: "rose" });
    const input = claudeThemeInput("blue", root);
    expect(input.family).toBe("dark");
    expect(input.accent).toBe(block(`${DARK}[data-accent="blue"]`).get("--accent"));
    // 모르는 강조색 값(옛 설정)은 기본 초록으로.
    expect(claudeThemeInput("nord", root).accent).toBe(resolve(FAMILY.dark, "--accent"));
  });

  // 표가 tokens.css 에서 갈라지면 Claude 의 색만 옛 색으로 남는다 — 토큰을 바꾸면 claudeTheme.ts 의 표도 바꾼다.
  it.each(["light", "dark"] as const)("%s: the unpainted background and the six app accents match tokens.css", (family) => {
    const root = windowRoot(family, { tint: "#808080", accent: "#808080", pc: "slate" });
    expect(claudeThemeInput("green", root).term.background).toBe(resolve(FAMILY[family], "--bg-content"));
    expect(claudeThemeInput("green", root).accent).toBe(resolve(FAMILY[family], "--accent"));
    for (const accent of ["blue", "purple", "orange", "rose", "teal"]) {
      const sel = family === "dark" ? `${DARK}[data-accent="${accent}"]` : `[data-accent="${accent}"]`;
      expect(claudeThemeInput(accent, root).accent, accent).toBe(block(sel).get("--accent"));
    }
  });
});
