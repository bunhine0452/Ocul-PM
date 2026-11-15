/**
 * 채운 단추 안의 키 표기 대비 (11-15 최종 검수).
 *
 * `.btn.primary .kbd` 의 면이 글자색 18% 였다 — 밝은 테마에서는 흰 글자 아래 면이 밝아져 「터미널에서 실행 r」 의
 * 키가 3.4:1(작은 글자 AA 4.5 미달), 시작 창 「폴더 열기 ⌘O」 는 3.75:1 이었다. 이제 면 없이 옅은 테 하나라 키의
 * 대비는 단추 이름과 같다. 두 가족 · 강조색 여덟 · 빨간 확인 단추를 tokens.css 에서 실제로 계산해 문다.
 */
import { describe, expect, it } from "vitest";

import { read } from "./designFs";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = strip(read("styles/tokens.css"));
const PRIM = strip(read("styles/primitives.css"));

function block(css: string, selector: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].trim() === selector) return m[2];
  throw new Error(`no ${selector} block`);
}
const decls = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

type Rgb = [number, number, number];
const hex = (h: string): Rgb => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
};
const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `a` 를 `p` 만큼 `b` 위에 — 옛 면(글자색 18%)이 단추 바탕 위에서 낸 색. */
const over = (a: Rgb, b: Rgb, p: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] * p + b[i] * (1 - p))) as Rgb;

function resolve(value: string, theme: Record<string, string>): Rgb {
  const ref = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (ref) return resolve(theme[ref[1]], theme);
  if (/^#[0-9a-f]{6}$/i.test(value.trim())) return hex(value.trim());
  throw new Error(`unresolvable colour: ${value}`);
}

const LIGHT = decls(block(TOKENS, ":root"));
const DARK = { ...LIGHT, ...decls(block(TOKENS, '[data-theme="dark"]')) };
const ACCENTS = [...TOKENS.matchAll(/^\[data-accent="(\w+)"\]\s*\{/gm)].map((m) => m[1]);

/** 그 가족 · 강조색의 토큰 — 프로젝트 색이 강조색이 되는 창도 같은 표에서 고른다(`projectAccent.ts`). */
function themeOf(family: "light" | "dark", accent: string | null): Record<string, string> {
  const base = family === "light" ? LIGHT : DARK;
  if (!accent) return base;
  const sel = family === "light" ? `[data-accent="${accent}"]` : `[data-theme="dark"][data-accent="${accent}"]`;
  return { ...base, ...decls(block(TOKENS, sel)) };
}

describe("keys inside filled buttons read as well as the button's name", () => {
  it("the key has no fill of its own — only a faint border in the button's text colour", () => {
    const body = block(PRIM, ".btn.primary .kbd,\n.cf .btn.cf-confirm.danger .kbd");
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/color:\s*inherit/);
    expect(body).toMatch(/border-color:\s*color-mix\(in srgb, currentColor \d+%, transparent\)/);
    expect(body).not.toMatch(/background:\s*color-mix/);
  });

  it("primary: --text-on-accent over --accent-strong is ≥ 4.5 in both families and every accent", () => {
    expect(ACCENTS.length).toBeGreaterThanOrEqual(6);
    for (const family of ["light", "dark"] as const) {
      for (const accent of [null, ...ACCENTS]) {
        const theme = themeOf(family, accent);
        const ink = resolve(theme["--text-on-accent"], theme);
        const face = resolve(theme["--accent-strong"], theme);
        expect(ratio(ink, face), `${family} ${accent ?? "default"}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the old 18% fill was the defect — light primary dropped under 4.5 with it", () => {
    const ink = resolve(LIGHT["--text-on-accent"], LIGHT);
    const face = resolve(LIGHT["--accent-strong"], LIGHT);
    expect(ratio(ink, over(ink, face, 0.18))).toBeLessThan(4.5);
    expect(ratio(ink, face)).toBeGreaterThanOrEqual(4.5);
  });

  it("the red confirm button: --on-danger over --danger is ≥ 4.5 in both families", () => {
    for (const theme of [LIGHT, DARK]) {
      expect(ratio(resolve(theme["--on-danger"], theme), resolve(theme["--danger"], theme))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
