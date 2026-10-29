// 계획 — 끝난 단계는 한 줄로 접히고 남은 단계가 먼저 선다 (4.0 「더 단순하게」).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlanItemDto } from "@/lib/bindings";
import { PlanItems } from "@/features/planner/PlanItems";

const item = (item_id: string, phase: string, status: string, order_idx: number): PlanItemDto => ({
  item_id,
  phase,
  title: `항목 ${item_id}`,
  status,
  order_idx,
  parent_item: null,
  note: null,
  last_agent: null,
  last_update: null,
  journal_refs: [],
});

describe("계획 항목 — 끝난 단계 접기", () => {
  afterEach(cleanup);

  const items = [
    item("a1", "engine", "done", 1),
    item("a2", "engine", "done", 2),
    item("b1", "ship", "done", 3),
    item("b2", "ship", "todo", 4),
  ];

  it("끝난 단계는 「이름 n/n」 한 줄이고 항목이 안 보인다 — 남은 단계는 펼쳐져 있다", () => {
    const { container } = render(<PlanItems items={items} locked={false} onSetStatus={() => {}} onOpenJournal={() => {}} />);
    expect(screen.queryByText("항목 a1")).toBeNull();
    expect(screen.getByText("항목 b2")).toBeInTheDocument();
    const folded = container.querySelector(".plv-done-row .plv-phase-done");
    expect(folded?.textContent).toContain("engine");
    expect(folded?.textContent).toContain("2/2");
    // 남은 단계(ship)가 격자 맨 앞이다.
    expect(container.querySelector(".plv-phase")?.getAttribute("aria-label")).toBe("ship");
  });

  it("접힌 줄을 누르면 그 단계가 펼쳐진다", () => {
    render(<PlanItems items={items} locked={false} onSetStatus={() => {}} onOpenJournal={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /engine/ }));
    expect(screen.getByText("항목 a1")).toBeInTheDocument();
  });
});
