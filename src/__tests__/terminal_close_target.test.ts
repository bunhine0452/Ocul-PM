/**
 * 터미널 탭의 닫기 × — 누르는 자리 24px 이상(WCAG 2.5.8), 그래도 옆 창 번호를 덮지 않는다 (love-round L6 #tab-close-target).
 *
 * jsdom 은 배치를 하지 않으니 CSS 값으로 셈한다: × 의 폭 · 높이와, 탭 왼쪽 끝에서 번호가 시작하는 자리
 * (고르는 단추의 왼쪽 여백 + 점 + 점 뒤 여백 + 사이 간격). 토큰은 tokens.css 에서 읽는다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, " ");
const term = strip(readFileSync(join(__dirname, "..", "features", "terminal", "terminal.css"), "utf8"));
const tokens = strip(readFileSync(join(__dirname, "..", "styles", "tokens.css"), "utf8"));

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(term);
  if (!m) throw new Error(`no rule ${selector}`);
  return m[1];
}

function decl(body: string, prop: string): string {
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body);
  if (!m) throw new Error(`no ${prop}`);
  return m[1].trim();
}

/** `12px` · `var(--space-3)` → px. */
function px(value: string): number {
  const v = /^var\((--[\w-]+)\)$/.exec(value);
  if (v) {
    const m = new RegExp(`${v[1]}\\s*:\\s*([\\d.]+)px`).exec(tokens);
    if (!m) throw new Error(`no token ${v[1]}`);
    return Number(m[1]);
  }
  if (value === "0") return 0;
  const m = /^([\d.]+)px$/.exec(value);
  if (!m) throw new Error(`not px: ${value}`);
  return Number(m[1]);
}

describe("terminal tab close target", () => {
  const close = rule(".tm-close");

  it("is at least 24px wide and spans the tab's full height (26px)", () => {
    expect(px(decl(close, "width"))).toBeGreaterThanOrEqual(24);
    expect(decl(close, "top")).toBe("0");
    expect(decl(close, "bottom")).toBe("0");
    expect(px(decl(rule(".tm-tab"), "height"))).toBeGreaterThanOrEqual(24);
  });

  it("ends before the session number starts — the wider target does not cover it", () => {
    const pick = rule(".tm-pick");
    const padLeft = px(decl(pick, "padding").split(/\s+/)[1]);
    const gap = px(decl(pick, "gap"));
    const dot = px(decl(rule(".tm-dot"), "width"));
    const dotGap = px(decl(rule(".tm-pick > .tm-dot"), "margin-right"));
    const numStart = padLeft + dot + dotGap + gap;
    expect(px(decl(close, "left")) + px(decl(close, "width"))).toBeLessThanOrEqual(numStart);
  });

  it("keeps the visible square small (the hover face is the icon's box, not the whole target)", () => {
    expect(rule(".tm-close:hover")).not.toMatch(/background/);
    expect(decl(rule(".tm-close:hover > svg"), "background")).toBe("var(--bg-active)");
  });
});
