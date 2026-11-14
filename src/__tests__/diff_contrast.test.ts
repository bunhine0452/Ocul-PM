// diff 대비 (11-15 #diff-contrast, DF-06) — 두 가족(라이트 · 다크)에서 diff 글자와 문법 색이 diff 의 세
// 바탕(카드 · add · del) 위 4.5:1 이상인지 토큰을 읽어 WCAG 공식으로 센다. 라이트에서 문자열이 2.7:1,
// 함수가 3.5:1, 거터 숫자가 3.2:1 이었다 — diff_v2 는 color-contrast 검사를 꺼 두어 그물이 없었다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "styles", "tokens.css"), "utf8");
const screens = readFileSync(join(__dirname, "..", "styles", "screens.css"), "utf8");
const changes = readFileSync(join(__dirname, "..", "features", "diff", "changes.css"), "utf8");

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

  // 바뀐 단어의 바탕은 줄 바탕 위에 겹친다(다크는 rgba) — 그 위 글자는 줄 종류의 글자색이다(아래 규칙).
  it("a changed word's ink reads at 4.5:1 on its ground (word over line over card)", () => {
    for (const kind of ["add", "del"] as const) {
      const line = rgb(resolve(fam, `--diff-${kind}-bg`), card);
      const word = rgb(resolve(fam, `--diff-${kind}-word`), line);
      expect(ratio(rgb(resolve(fam, `--diff-${kind}-text`), card), word), kind).toBeGreaterThanOrEqual(4.5);
    }
  });

  // 본 파일 행은 이름만 --text-2 로 한 단 내린다 — 목록 칸의 두 바탕(묶음 밖 · 묶음 안) 위에서 읽혀야 한다.
  it("a viewed row's name (--text-2) reads on the list grounds", () => {
    const ink = rgb(resolve(fam, "--text-2"), card);
    for (const ground of ["--bg-window", "--bg-content"]) {
      expect(ratio(ink, rgb(resolve(fam, ground), card)), ground).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("viewed rows", () => {
  // opacity 0.55 로 행을 흐리던 때 폴더 · 시각이 라이트에서 2.3:1 이었다 — 누를 수 있는 행인데 읽히지 않았다.
  it("are not dimmed with opacity — the name steps down to --text-2", () => {
    const rules = [...changes.matchAll(/([^{}]*is-viewed[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, , body] of rules) expect(body).not.toMatch(/opacity/);
    expect(changes).toMatch(/\.is-viewed[^{]*\.chg-base \{[^}]*color: var\(--text-2\)/);
  });
});

describe("markers and numbers", () => {
  it("the +/- marker carries no opacity — it takes the line kind's colour", () => {
    const rule = /\n\.dl-mark \{([^}]*)\}/.exec(screens)?.[1] ?? "";
    expect(rule).not.toMatch(/opacity/);
  });

  // 문법 색은 바뀐 단어 바탕 위에서 4.2:1(라이트 del 위 문자열) · 3.3:1(다크 add 위 주석)까지 내려갔다.
  it("a changed word takes the line kind's ink, not the syntax colours", () => {
    expect(screens).toMatch(/\.dl\.add \.dl-word, \.dl-x\.add \.dl-word \{[^}]*(?<![-\w])color: var\(--diff-add-text\)/);
    expect(screens).toMatch(/\.dl\.del \.dl-word, \.dl-x\.del \.dl-word \{[^}]*(?<![-\w])color: var\(--diff-del-text\)/);
  });

  it("gutter numbers and the +N/-M summary use the -text tier", () => {
    expect(screens).toMatch(/\.dl\.add \.dl-gut, \.dl-gut\.add \{[^}]*color: var\(--diff-add-text\)/);
    expect(screens).toMatch(/\.dl\.del \.dl-gut, \.dl-gut\.del \{[^}]*color: var\(--diff-del-text\)/);
    expect(screens).toMatch(/\.diff-stat \.add \{ color: var\(--diff-add-text\)/);
    expect(screens).toMatch(/\.diff-stat \.del \{ color: var\(--diff-del-text\)/);
  });
});
