/**
 * 터미널 상태 띠는 칸 오른쪽 위의 알약 하나다 (love-round L6 #status-band-overlay).
 *
 * 칸 폭 전체이던 때는 기다림 · 일지 없음 동안 Claude 전체 화면의 맨 윗줄(31px)을 통째로 가렸다. 알약은 제 글만큼만
 * 넓고, 빈 자리는 터미널로 통한다(겹침 층은 누름을 받지 않고 알약만 받는다). 격자 크기는 그대로다(겹침은 절대 위치).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "features", "terminal", "terminal.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule ${selector}`);
  return m[1];
}

describe("terminal status band — a pill at the pane's top-right", () => {
  const band = rule(".tm-band");

  it("is only as wide as its content and sits at the right edge", () => {
    expect(band).toMatch(/align-self:\s*flex-end/);
    expect(band).toMatch(/width:\s*max-content/);
    expect(band).toMatch(/max-width:\s*calc\(100% - 2 \* var\(--space-3\)\)/);
    expect(band).toMatch(/border-radius:\s*var\(--radius-pill\)/);
  });

  it("is not a full-width strip any more (no bottom rule across the pane)", () => {
    expect(band).not.toMatch(/border-bottom:/);
    expect(band).not.toMatch(/align-self:\s*stretch/);
  });

  it("lets clicks on the empty overlay fall through to the terminal", () => {
    expect(rule(".tm-over")).toMatch(/pointer-events:\s*none/);
    expect(rule(".tm-over > *")).toMatch(/pointer-events:\s*auto/);
  });

  it("an exception pill keeps colour for the exception only (amber edge)", () => {
    expect(rule(".tm-band.is-warn")).toMatch(/border-color:\s*var\(--warn\)/);
  });
});
