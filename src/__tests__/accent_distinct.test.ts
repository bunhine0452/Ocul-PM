// 강조색 대 의미색 (11-15 #accent-colors, X-01) — 프로젝트 색을 고르면 그 팔레트가 창의 강조색이 된다
// (`features/theme/projectAccent.ts`). 예전 분홍의 --accent 는 --danger 와 같은 값이었고 다크 주황은 --warn 과
// 같아서, 장미색 창에선 주 단추와 위험 확인 단추가 같은 빨강이었다(영수증 규칙 1 · 4). WCAG 대비는 밝기만 재서
// 「같은 색」을 못 잡는다 — 그래서 tokens.css 를 캐스케이드대로 풀어(design_tokens.test.ts 의 parseBlocks · resolve
// 와 같은 방식) OKLab 거리로 잰다.
import { describe, expect, it } from "vitest";
import { read } from "./designFs";

const TOKENS = read("styles/tokens.css");

/** 이보다 가까우면 나란히 놓아도 한 색으로 읽힌다 (OKLab, L 0~1). 값은 0.09 언저리로 골랐다 — 문턱에 붙이지 말 것. */
const MIN_DE = 0.08;
/** 옅은 바탕(-soft)끼리는 다 하얗게 붙어 ΔE 로는 못 가른다 — 색상각이 이만큼 떨어지면 다른 색이다. */
const SOFT_MIN_HUE = 10;
/** 이보다 옅은 soft 는 회색이다(slate) — 견줄 색조가 없다. */
const SOFT_MIN_CHROMA = 0.01;

/** 칠하는 자리의 의미색 — 위험 확인 단추 · 경고 배지 · 위험 단추 글자 · 일지 버그/에러 색. */
const FILL_MEANINGS = ["--danger", "--warn", "--t-bug", "--t-error"];
/** 글자 자리의 의미색 — 칩 · 오류 글자. --accent-text(고른 탭 · 링크 글자)와 견준다. */
const TEXT_MEANINGS = ["--danger-text", "--warn-text"];
const SOFT_MEANINGS = ["--danger-soft", "--warn-soft", "--t-bug-soft", "--t-error-soft"];
/** 칠하는 강조 토큰. --accent-text 는 주 단추를 가리켰을 때의 바탕이기도 하다(primitives.css `.btn.primary:hover`). */
const FILLS = ["--accent", "--accent-strong", "--accent-text", "--accent-ring", "--accent-soft"];

type Rgb = [number, number, number];

function parseBlocks(css: string): Map<string, Record<string, string>> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, Record<string, string>>();
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    const decls: Record<string, string> = {};
    for (const decl of m[2].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const key = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim();
      if (key.startsWith("--") && value) decls[key] = value;
    }
    if (Object.keys(decls).length > 0) out.set(selector, { ...out.get(selector), ...decls });
  }
  return out;
}

const DARK = '[data-theme="dark"]';

/** 팔레트마다 두 가족(라이트 · 다크)에서 실제로 풀리는 값. green 은 바탕값이라 블록이 없다. */
function palettes(css: string): { name: string; t: Record<string, string> }[] {
  const blocks = parseBlocks(css);
  // 블록이 빠지면 바탕(green)값으로 풀려 그 팔레트가 공짜로 통과한다 — 조용히 넘기지 않는다.
  const block = (s: string) => {
    const b = blocks.get(s);
    if (!b) throw new Error(`tokens.css has no ${s} block`);
    return b;
  };
  const pick = (chain: string[]) => Object.assign({}, ...chain.map(block));
  const accents = [...new Set([...css.matchAll(/^\[data-accent="(\w+)"\] \{/gm)].map((m) => m[1]))];
  return ["green", ...accents].flatMap((a) => [
    { name: `${a}/light`, t: pick([":root", ...(a === "green" ? [] : [`[data-accent="${a}"]`])]) },
    { name: `${a}/dark`, t: pick([":root", DARK, ...(a === "green" ? [] : [`${DARK}[data-accent="${a}"]`])]) },
  ]);
}

/** 색 값의 RGB — rgba 는 알파를 뺀 rgb 부분(그 칠의 색조가 거기서 온다). */
function solid(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!m) throw new Error(`unparsed colour ${value}`);
  return m[1].split(",").slice(0, 3).map(Number) as Rgb;
}

/** 바탕 위에 얹은 RGB — rgba 는 섞고, 단색은 그대로. */
function over(value: string, under: Rgb): Rgb {
  const m = /^rgba\(([^)]+)\)$/.exec(value.trim());
  if (!m) return solid(value);
  const [r, g, b, a] = m[1].split(",").map(Number);
  return [r, g, b].map((c, i) => c * a + under[i] * (1 - a)) as Rgb;
}

function oklab([r, g, b]: Rgb): Rgb {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaE(x: Rgb, y: Rgb): number {
  const [a, b] = [oklab(x), oklab(y)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** OKLCH 의 색상각(도)과 채도. */
function hue(c: Rgb): { h: number; chroma: number } {
  const [, a, b] = oklab(c);
  return { h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(a, b) };
}

function contrast(x: Rgb, y: Rgb): number {
  const lum = (c: Rgb) => {
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
  };
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

type Kind = "fill" | "text" | "soft";

/** 강조색이 의미색에 붙은 자리를 모두 센다 — 비어 있어야 한다. */
function collisions(css: string): { kind: Kind; at: string }[] {
  const out: { kind: Kind; at: string }[] = [];
  for (const { name, t } of palettes(css)) {
    for (const k of FILLS) {
      // 단색 soft(라이트)는 거의 흰색이라 본색과 재면 늘 멀다 — 아래 색상각으로 잰다.
      if (k === "--accent-soft" && !t[k].startsWith("rgba")) continue;
      for (const m of FILL_MEANINGS) {
        const d = deltaE(solid(t[k]), solid(t[m]));
        if (d < MIN_DE) out.push({ kind: "fill", at: `${name} ${k} ~ ${m} ΔE ${d.toFixed(3)}` });
      }
    }
    for (const m of TEXT_MEANINGS) {
      const d = deltaE(solid(t["--accent-text"]), solid(t[m]));
      if (d < MIN_DE) out.push({ kind: "text", at: `${name} --accent-text ~ ${m} ΔE ${d.toFixed(3)}` });
    }
    const soft = t["--accent-soft"];
    if (soft.startsWith("rgba")) continue;
    const card = solid(t["--bg-card"]);
    const mine = hue(over(soft, card));
    if (mine.chroma < SOFT_MIN_CHROMA) continue;
    for (const m of SOFT_MEANINGS) {
      const gap = Math.abs(mine.h - hue(over(t[m], card)).h) % 360;
      const deg = Math.min(gap, 360 - gap);
      if (deg < SOFT_MIN_HUE) out.push({ kind: "soft", at: `${name} --accent-soft ~ ${m} ${deg.toFixed(1)}°` });
    }
  }
  return out;
}

describe("accent palettes stay off the meaning colours (danger · warn · journal bug/error)", () => {
  it("covers every [data-accent] palette in both families, the project-only three included", () => {
    const names = palettes(TOKENS).map((p) => p.name);
    for (const a of ["green", "blue", "purple", "teal", "slate", "rose", "orange", "amber"]) {
      expect(names, a).toEqual(expect.arrayContaining([`${a}/light`, `${a}/dark`]));
    }
  });

  it("no accent token sits within the ΔE threshold of a meaning colour", () => {
    expect(collisions(TOKENS).map((c) => c.at)).toEqual([]);
  });

  it("the old rose (28077f31) is caught on all three measures — the check bites", () => {
    // 예전 값을 덧붙이면(뒤 선언이 이긴다) 칠 · 글자 · 옅은 바탕 셋 다 걸려야 한다.
    const oldRose = `
[data-accent="rose"] {
  --accent: #e0524b; --accent-strong: #d23f38; --accent-text: #c0352e;
  --accent-soft: #fbe9e8; --accent-ring: rgba(224,82,75,0.35);
}
[data-theme="dark"][data-accent="rose"] {
  --accent: #f1685f; --accent-strong: #ed564c; --accent-text: #f7918a;
  --accent-soft: rgba(241,104,95,0.16); --accent-ring: rgba(241,104,95,0.4);
}`;
    const hits = collisions(TOKENS + oldRose);
    expect(hits.every((h) => h.at.startsWith("rose/")), hits.map((h) => h.at).join("\n")).toBe(true);
    expect(new Set(hits.map((h) => h.kind))).toEqual(new Set<Kind>(["fill", "text", "soft"]));
  });
});

describe("filled accent buttons keep readable ink", () => {
  // 주 단추 바탕은 --accent-strong, 가리키면 --accent-text 다(primitives.css `.btn.primary`). 글자는 그 가족의
  // --text-on-accent — 블록이 따로 잉크를 두지 않는다.
  it.each(palettes(TOKENS).map((p) => [p.name, p.t] as const))("%s", (_name, t) => {
    const ink = solid(t["--text-on-accent"]);
    for (const bg of ["--accent-strong", "--accent-text"]) {
      expect(Math.round(contrast(ink, solid(t[bg])) * 100) / 100, `--text-on-accent on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
