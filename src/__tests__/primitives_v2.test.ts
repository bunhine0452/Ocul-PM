/**
 * 전역 프리미티브 바로잡기 (11-15) — 한 번 고치면 다섯 화면이 함께 좋아지는 바닥.
 *
 *  ① 다크에서 세그먼트의 고른 칸(#232826)이 트랙(#282e2b)보다 어두워 빈 구멍으로 보였다 → --seg-on
 *  ② 막힌 주 단추가 옅은 채운 단추(opacity .45)로 남아 한 화면에 채운 단추가 둘이었다
 *  ③ 주 단추 아래 --accent-ring 그림자가 다크에서 초록으로 번졌다(글로우)
 *  ④ 위험 단추가 빨강 위 초록 포커스 테였다
 *  ⑤ 좁은 창에서 세그먼트 글자가 칸 밖으로 넘쳤다
 *  ⑥ 포커스 링 · 아이콘 획 보정이 셸 청크(base.css)에만 실려 시작 창엔 없었다
 *
 * CSS 는 jsdom 이 적용하지 않으니 **파일을 읽어** 규칙을 문다. 색은 tokens.css 를 파싱해 실제로 계산한다.
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error — 빌드 대상이 아닌 zero-dep 검사 스크립트 (.mjs, 타입 없음).
import { accentRingHits } from "../../scripts/design-accent-ring.mjs";
import { read } from "./designFs";

const TOKENS = read("styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
const PRIM = read("styles/primitives.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** `selector { … }` 의 선언 덩이 — 셀렉터가 정확히 같은 블록만. */
function block(css: string, selector: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() === selector) return m[2];
  }
  throw new Error(`no ${selector} block`);
}
/** 블록 안의 커스텀 프로퍼티 값. */
function token(body: string, name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(body);
  if (!m) throw new Error(`no ${name}`);
  return m[1].trim();
}

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

/** `var(--x)` 를 그 테마의 값으로 풀고, `color-mix(in srgb, A N%, B)` 는 sRGB 로 섞는다. */
function resolveColor(value: string, theme: Record<string, string>): Rgb {
  const v = value.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return resolveColor(theme[ref[1]], theme);
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    const a = resolveColor(mix[1], theme);
    const b = resolveColor(mix[3], theme);
    const p = Number(mix[2]) / 100;
    return [0, 1, 2].map((i) => Math.round(a[i] * p + b[i] * (1 - p))) as Rgb;
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return hex(v);
  throw new Error(`unresolvable colour: ${v}`);
}

const ROOT = block(TOKENS, ":root");
const DARK = block(TOKENS, '[data-theme="dark"]');
const themeOf = (...blocks: string[]) => {
  const out: Record<string, string> = {};
  for (const b of blocks) {
    for (const m of b.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  }
  return out;
};
const LIGHT_T = themeOf(ROOT);
const DARK_T = themeOf(ROOT, DARK);

describe("1 segment — the picked cell is lighter than the track", () => {
  it("dark: --seg-on is at least 1.25:1 lighter than --bg-inset", () => {
    const on = resolveColor(token(DARK, "--seg-on"), DARK_T);
    const track = resolveColor(DARK_T["--bg-inset"], DARK_T);
    expect(luminance(on)).toBeGreaterThan(luminance(track));
    expect(ratio(on, track)).toBeGreaterThanOrEqual(1.25);
    // 예전 값(--bg-card)은 트랙보다 **어두웠다** — 그게 빈 구멍이었다.
    expect(luminance(resolveColor(DARK_T["--bg-card"], DARK_T))).toBeLessThan(luminance(track));
  });

  it("light: the picked cell is lighter than the track", () => {
    const on = resolveColor(token(ROOT, "--seg-on"), LIGHT_T);
    const track = resolveColor(LIGHT_T["--bg-inset"], LIGHT_T);
    expect(luminance(on)).toBeGreaterThan(luminance(track));
  });

  it("the picked cell paints --seg-on with a one-hairline inset edge", () => {
    const sel = block(PRIM, '.seg-item:is([aria-selected="true"], [aria-checked="true"], [aria-pressed="true"])');
    expect(sel).toMatch(/background:\s*var\(--seg-on\)/);
    expect(sel).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--sep-strong\)/);
  });

  it("5 narrow window — cells never break, the track wraps instead", () => {
    expect(block(PRIM, ".seg")).toMatch(/flex-wrap:\s*wrap/);
    const item = block(PRIM, ".seg-item");
    expect(item).toMatch(/white-space:\s*nowrap/);
    expect(item).toMatch(/flex:\s*none/);
  });
});

describe("2 · 3 primary button", () => {
  it("the blocked primary rule has no opacity — it looks like a regular button (card · text-2 · border)", () => {
    const off = block(PRIM, '.btn.primary:is(:disabled, [aria-disabled="true"])');
    expect(off).not.toMatch(/opacity/);
    expect(off).toMatch(/background-color:\s*var\(--bg-card\)/);
    expect(off).toMatch(/color:\s*var\(--text-2\)/);
    expect(off).toMatch(/border-color:\s*var\(--border-card\)/);
    // 흐림은 주 단추가 아닌 단추에만 걸린다 — 주 단추에 새어 들어오지 않는다.
    expect(block(PRIM, '.btn:not(.primary):is(:disabled, [aria-disabled="true"])')).toMatch(/opacity/);
    for (const m of PRIM.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/opacity/.test(m[2]) && /\.btn\b/.test(m[1]) && /disabled/.test(m[1])) {
        expect(m[1], "a dimming rule reaches the primary button").toMatch(/:not\(\.primary\)/);
      }
    }
  });

  it("a blocked button does not turn accent on hover", () => {
    expect(PRIM).toMatch(/\.btn\.primary:hover:not\(:disabled, \[aria-disabled="true"\]\)/);
  });

  it("no --accent-ring in the primary button shadow (glow)", () => {
    for (const m of PRIM.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\.btn\.primary/.test(m[1])) continue;
      expect(m[2], `accent halo on ${m[1].trim()}`).not.toMatch(/accent-ring/);
    }
  });

  it("the red confirm button casts no coloured shadow either", () => {
    expect(block(PRIM, ".cf .btn.cf-confirm.danger")).not.toMatch(/box-shadow/);
  });
});

describe("4 danger button focus ring", () => {
  it("the ring on red is red", () => {
    const body = block(PRIM, ".btn.danger:focus-visible,\n.iconbtn.danger:focus-visible");
    expect(body).toMatch(/outline-color:\s*var\(--danger\)/);
  });
});

describe("6 focus ring · stroke fix live on every window floor (window.css)", () => {
  const win = read("windows/window.css");
  const base = read("styles/base.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("window.css carries the focus-visible rule with its selectors unchanged", () => {
    expect(win).toMatch(/\[tabindex="0"\]\s*\):focus-visible \{\s*outline: var\(--focus-w\) solid var\(--focus-color\);/);
    expect(win).toMatch(/:where\(button\) \{/);
    expect(win).toMatch(/svg\.lucide\[width="15"\], svg\.lucide-icon\[width="15"\] \{ stroke-width: 1\.9; \}/);
  });

  it("base.css (shell chunk only) no longer has them — no second copy", () => {
    expect(base).not.toMatch(/:focus-visible/);
    expect(base).not.toMatch(/:where\(button\)/);
    expect(base).not.toMatch(/stroke-width/);
  });

  it("the window imports window.css itself (so the start window gets it)", () => {
    expect(read("windows/AppWindow.tsx")).toMatch(/import "\.\/window\.css";/);
  });
});

// 규칙 22 의 판정 그 자체 — 게이트(check-design-discipline.mjs)가 같은 함수를 부른다. 예전 시험은 게이트에
// 함수 이름이 있는지만 봐서, 몸통을 비워도 초록이었다.
type Hit = { line: number; what: string };
const hits = (src: string, isCss: boolean): Hit[] => accentRingHits(src, src.split("\n"), isCss);
const css = (src: string) => hits(src, true);
const tsx = (src: string) => hits(src, false);

describe("rule 22 — the accent halo is for focus rings only (lint:design)", () => {
  it("flags a halo off focus — the primary glow, one unfocused part of a list, an inline TSX shadow", () => {
    expect(css(".btn.primary { box-shadow: 0 1px 2px var(--accent-ring) }")).toHaveLength(1);
    expect(css(".a, .b:focus-visible { box-shadow: var(--ring-soft) }")).toHaveLength(1);
    expect(tsx('const s = { boxShadow: "0 0 0 3px var(--accent-ring)" };')).toHaveLength(1);
  });

  it("passes a halo on a focus state, and neutral shadows", () => {
    expect(css(".x:focus-visible { box-shadow: var(--ring-soft) }")).toEqual([]);
    expect(css(".x:focus-within,\n.y:focus { box-shadow: var(--ring-soft); }")).toEqual([]);
    expect(css(".x { box-shadow: var(--shadow-card) }")).toEqual([]);
    expect(tsx("const s = { boxShadow: shadow, color: 'var(--accent-ring)' };")).toEqual([]);
  });

  it("closes the gaps — a layered TSX shadow, a later declaration, :not(:focus)", () => {
    expect(tsx('<i style={{ boxShadow: "0 1px 0 var(--sep), 0 0 0 2px var(--accent-ring)" }} />')).toHaveLength(1);
    const later = css(".x {\n  box-shadow: none;\n  box-shadow: 0 0 0 2px var(--accent-ring);\n}");
    expect(later).toEqual([{ line: 3, what: ".x { box-shadow: 0 0 0 2px var(--accent-ring) }" }]);
    expect(css(".x:not(:focus-visible) { box-shadow: var(--ring-soft) }")).toHaveLength(1);
  });

  it("a design-ignore with a reason on the line or the three above lets it through", () => {
    expect(css("/* design-ignore -- reason */\n.x { box-shadow: var(--ring-soft) }")).toEqual([]);
  });

  it("the gate runs it on every file", () => {
    const gate = read("../scripts/check-design-discipline.mjs");
    expect(gate).toMatch(/import \{ accentRingHits \} from "\.\/design-accent-ring\.mjs";/);
    expect(gate).toMatch(/accentRingHits\(src, rawLines, isCss\)/);
    expect(gate).toMatch(/checkAccentRing\(rel, src, rawLines, isCss\);/);
  });

  it("every halo in primitives today sits on a focus state", () => {
    expect(css(PRIM)).toEqual([]);
  });
});
