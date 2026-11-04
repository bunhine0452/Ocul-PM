// 윗줄 접기 단계 (11-04) — 폭 숫자(@media)가 아니라 들어가는지 재서 접는다(`useTopbarFit`), 위 색 띠는 없다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(resolve(__dirname, "../styles/shell.css"), "utf8");

describe("top bar fit", () => {
  it("folds by measured steps, not by viewport widths", () => {
    expect(shell).not.toMatch(/@media \(max-width: (640|780|900)px\)/);
    expect(shell).toMatch(/\.topbar\[data-fit\] \.kbd \{ display: none; \}/);
    expect(shell).toMatch(/\.topbar\[data-fit="3"\] \.topbar-actions \{ display: none; \}/);
    // 화면 동작은 줄지 않는다 — 잘리는 대신 다음 단계로 간다.
    expect(shell).toMatch(/\.topbar-actions \{ flex-shrink: 0; \}/);
  });

  it("has no thick colour band along the top edge", () => {
    expect(shell).not.toMatch(/inset 0 3px 0 var\(--pc\)/);
  });
});
