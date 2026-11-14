import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Disclosure } from "@/components/Disclosure";

// JN-08 (11-15) — the journal and planner share one frame: the list column is `--panel-w` on both (it was
// 400 · 260 and the document title jumped from x 424 to 288 between tabs), the document padding is 24, the
// selected row is a surface only (its weight never changes), boxes inside the document are borders only, and
// one fold handle (`Disclosure`) serves all five places that fold.

const src = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const css = (rel: string) => src(rel).replace(/\/\*[\s\S]*?\*\//g, " ");
const journalCss = css("features/oculpm/journal.css");
const plannerCss = css("features/planner/planner.css");

afterEach(() => cleanup());

describe("journal · planner — one frame", () => {
  it("both list columns take the shared --panel-w (yielding 45% of a narrow window)", () => {
    expect(journalCss).toMatch(/\.jl-col\s*\{[^}]*width:\s*var\(--panel-w\);[^}]*max-width:\s*45%/);
    expect(plannerCss).toMatch(/\.plv-rail\s*\{[^}]*width:\s*var\(--panel-w\);[^}]*max-width:\s*45%/);
    expect(src("styles/tokens.css")).toMatch(/--panel-w:\s*320px;/);
  });

  it("both documents are padded 24 and the selected row changes its surface, never its weight", () => {
    expect(journalCss).toMatch(/\.jd\s*\{[^}]*padding:\s*var\(--space-8\)/);
    expect(plannerCss).toMatch(/\.plv-main\s*\{[^}]*padding:\s*var\(--space-8\) var\(--space-8\)/);
    expect(plannerCss).not.toMatch(/\.plv-li\[aria-current="true"\][^{]*\{[^}]*font-weight/);
    expect(journalCss).not.toMatch(/\.jl-item\[aria-selected="true"\][^{]*\{[^}]*font-weight/);
    // 문서 안 상자는 테두리만 — 단계 상자 · 판정 카드에 그림자가 없다.
    expect(plannerCss).not.toMatch(/\.plv-phase\s*\{[^}]*box-shadow/);
    expect(plannerCss).not.toMatch(/\.plv-judge\s*\{[^}]*box-shadow/);
  });

  it("planner.css carries no off-ramp values (22 · 28 · 18 · 14 · 9 · 60 · 260px)", () => {
    const hits = [...plannerCss.matchAll(/(?<![\d.])(22|28|18|14|9|60|260)px/g)].map((m) => m[0]);
    expect(hits).toEqual([]);
  });

  it("the five folds use Disclosure — no hand-made <details> handles remain", () => {
    for (const file of [
      "features/oculpm/JournalList.tsx",
      "features/planner/PlanRail.tsx",
      "features/planner/PlanLog.tsx",
      "features/planner/CarryInbox.tsx",
      "features/planner/PlanItems.tsx",
    ]) {
      const code = src(file);
      expect(code, file).toMatch(/<Disclosure\b/);
      expect(code, file).not.toMatch(/<details\b/);
    }
  });

  it("Disclosure toggles aria-expanded, shows its body only when open, and folds back on a second press", () => {
    render(createElement(Disclosure, { label: "Gone", count: 3, children: createElement("p", null, "inside") }));
    const head = screen.getByRole("button", { name: "Gone 3" });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("inside")).toBeNull();
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("inside")).toBeInTheDocument();
    expect(head.getAttribute("aria-controls")).toBe(screen.getByText("inside").parentElement?.id);
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("inside")).toBeNull();
  });

  it("a controlled Disclosure follows its owner (a fold the person opened stays open)", () => {
    const seen: boolean[] = [];
    const onToggle = (o: boolean) => void seen.push(o);
    const view = render(createElement(Disclosure, { label: "Day", open: true, onToggle, children: "rows" }));
    const head = screen.getByRole("button", { name: "Day" });
    fireEvent.click(head);
    // 제어형 — 부모가 열림을 쥐므로 누름은 알림만 하고, 부모가 닫기 전까지 열린 채다.
    expect(seen).toEqual([false]);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    view.rerender(createElement(Disclosure, { label: "Day", open: false, onToggle, children: "rows" }));
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });
});
