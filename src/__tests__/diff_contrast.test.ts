// diff 대비 (11-15 #diff-contrast, DF-06) — 두 가족(라이트 · 다크)에서 diff 글자와 문법 색이 diff 의 세
// 바탕(카드 · add · del) 위 4.5:1 이상인지 토큰을 읽어 WCAG 공식으로 센다. 라이트에서 문자열이 2.7:1,
// 함수가 3.5:1, 거터 숫자가 3.2:1 이었다 — diff_v2 는 color-contrast 검사를 꺼 두어 그물이 없었다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "styles", "tokens.css"), "utf8");
const screens = readFileSync(join(__dirname, "..", "styles", "screens.css"), "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const light = block(":root");
const dark = new Map([...light, ...block('[data-theme="dark"]')]);

type Rgb = [number, number, number];

function resolve(fam: Map<string, string>, name: string): string {
  let v = fam.get(name) ?? "";
  for (let i = 0; i < 5 && v.startsWith("var("); i++) v = fam.get(/var\((--[\w-]+)/.exec(v)![1]) ?? "";
  return v;
}

/** 색 하나를 바탕 위에 얹은 RGB — rgba 는 카드 위에 섞는다. */
function rgb(value: string, under: Rgb = [255, 255, 255]): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  const m = /^rgba?\(([^)]+)\)$/.exec(value);
  if (!m) throw new Error(`unparsed colour ${value}`);
  const [r, g, b, a = 1] = m[1].split(",").map(Number);
  return [r, g, b].map((c, i) => c * a + under[i] * (1 - a)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const INK = [
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
  "--diff-add-text",
  "--diff-del-text",
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s family", (_name, fam) => {
  const card = rgb(resolve(fam, "--bg-card"));
  const grounds: Array<[string, Rgb]> = [
    ["card", card],
    ["add", rgb(resolve(fam, "--diff-add-bg"), card)],
    ["del", rgb(resolve(fam, "--diff-del-bg"), card)],
  ];

  it.each(INK)("%s reads at 4.5:1 or more on card, add and del", (ink) => {
    const c = rgb(resolve(fam, ink), card);
    for (const [ground, bg] of grounds) {
      expect(ratio(c, bg), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("context line numbers read on the gutter, and the gutter is a step off the card", () => {
    const gutter = rgb(resolve(fam, "--diff-gutter"), card);
    expect(ratio(rgb(resolve(fam, "--text-2"), card), gutter)).toBeGreaterThanOrEqual(4.5);
    expect(gutter).not.toEqual(card);
  });

  it("defines the changed-word grounds", () => {
    expect(resolve(fam, "--diff-add-word")).not.toBe("");
    expect(resolve(fam, "--diff-del-word")).not.toBe("");
  });
});

describe("markers and numbers", () => {
  it("the +/- marker carries no opacity — it takes the line kind's colour", () => {
    const rule = /\n\.dl-mark \{([^}]*)\}/.exec(screens)?.[1] ?? "";
    expect(rule).not.toMatch(/opacity/);
  });

  it("gutter numbers and the +N/-M summary use the -text tier", () => {
    expect(screens).toMatch(/\.dl\.add \.dl-gut, \.dl-gut\.add \{[^}]*color: var\(--diff-add-text\)/);
    expect(screens).toMatch(/\.dl\.del \.dl-gut, \.dl-gut\.del \{[^}]*color: var\(--diff-del-text\)/);
    expect(screens).toMatch(/\.diff-stat \.add \{ color: var\(--diff-add-text\)/);
    expect(screens).toMatch(/\.diff-stat \.del \{ color: var\(--diff-del-text\)/);
  });
});
