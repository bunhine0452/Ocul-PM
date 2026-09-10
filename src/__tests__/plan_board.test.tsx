// 계획 보드 (칸반) — 열·카드·드래그가 문서 보기와 같은 사실을 말하는가.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BOARD_DONE_PREVIEW, PlanBoard } from "@/features/planner/PlanBoard";
import type { PlanItemDto } from "@/lib/bindings";

afterEach(cleanup);

function item(id: string, status: string, over: Partial<PlanItemDto> = {}): PlanItemDto {
  return {
    item_id: id, phase: "Phase A", title: `제목 ${id}`, status, order_idx: 0, parent_item: null,
    note: null, last_agent: "claude-code", last_update: "2026-09-10T10:00:00+09:00",
    journal_refs: [], ...over,
  };
}

const items: PlanItemDto[] = [
  item("a1", "todo"),
  item("a2", "blocked"),
  item("p", "done"),
  item("c1", "done", { parent_item: "p", journal_refs: ["journal/20260910/Bugs/1_a.md", "journal/20260910/Bugs/2_b.md"] }),
  item("b1", "in_progress", { phase: "Phase B" }),
  item("x", "dropped"),
];

/** jsdom 은 DataTransfer 가 없다 — 드래그 이벤트에 얹을 최소 구현. */
function dt() {
  const store = new Map<string, string>();
  return {
    types: [] as string[],
    effectAllowed: "all",
    dropEffect: "none",
    setData(k: string, v: string) { store.set(k, v); this.types = [...store.keys()]; },
    getData(k: string) { return store.get(k) ?? ""; },
  };
}

function setup(over: { items?: PlanItemDto[]; locked?: boolean } = {}) {
  const onSetStatus = vi.fn();
  const onDispatch = vi.fn();
  const onOpenJournalRef = vi.fn();
  render(
    <PlanBoard
      items={over.items ?? items}
      busy={false}
      locked={over.locked ?? false}
      onSetStatus={onSetStatus}
      onDispatch={onDispatch}
      onOpenJournalRef={onOpenJournalRef}
    />,
  );
  return { onSetStatus, onDispatch, onOpenJournalRef };
}

describe("보드 — 열과 카드", () => {
  it("기본 네 열 + 항목이 있는 선택 열, 리프만 카드로", () => {
    setup();
    const cols = screen.getAllByRole("listitem");
    expect(cols.map((c) => c.getAttribute("aria-label"))).toEqual([
      "할 일 1", "진행중 1", "막힘 1", "완료 1", "폐기 1",
    ]);
    // 부모 p 는 카드가 아니고, 하위 c1 카드에 빵부스러기로 붙는다.
    expect(document.querySelector('[data-item-id="p"]')).toBeNull();
    const c1 = document.querySelector('[data-item-id="c1"]')!;
    expect(c1.querySelector(".pln-card-parent")?.textContent).toBe("제목 p");
    expect(c1.querySelector(".pln-card-title")?.classList.contains("done")).toBe(true);
  });

  it("빈 열은 「없음」, 완료 열은 미리보기 뒤 「N개 더 보기」", () => {
    const many = Array.from({ length: BOARD_DONE_PREVIEW + 3 }, (_, i) => item(`d${i}`, "done"));
    setup({ items: many });
    expect(within(screen.getByRole("listitem", { name: "할 일 0" })).getByText("없음")).toBeInTheDocument();
    const done = screen.getByRole("listitem", { name: `완료 ${many.length}` });
    expect(done.querySelectorAll(".pln-card")).toHaveLength(BOARD_DONE_PREVIEW);
    fireEvent.click(within(done).getByText("3개 더 보기"));
    expect(done.querySelectorAll(".pln-card")).toHaveLength(many.length);
  });

  it("카드 액션 — 일지는 최근 것을 열고, 실행은 완료·폐기엔 없고, ▾ 는 상태 메뉴", () => {
    const { onOpenJournalRef, onDispatch, onSetStatus } = setup();
    const c1 = document.querySelector('[data-item-id="c1"]') as HTMLElement;
    fireEvent.click(within(c1).getByTitle(/연결된 일지 2건/));
    expect(onOpenJournalRef).toHaveBeenCalledWith("journal/20260910/Bugs/2_b.md");
    expect(within(c1).queryByTitle(/실행/)).toBeNull();

    const a1 = document.querySelector('[data-item-id="a1"]') as HTMLElement;
    fireEvent.click(within(a1).getByTitle(/실행/));
    expect(onDispatch).toHaveBeenCalledWith(expect.objectContaining({ item_id: "a1" }));
    fireEvent.click(within(a1).getByTitle("상태 바꾸기"));
    fireEvent.click(within(screen.getByRole("menu", { name: /제목 a1/ })).getByText("이월"));
    expect(onSetStatus).toHaveBeenCalledWith(expect.objectContaining({ item_id: "a1" }), "deferred");
  });
});

describe("보드 — 드래그", () => {
  it("다른 열에 놓으면 그 상태로, 같은 열이면 아무 일도 없다", () => {
    const { onSetStatus } = setup();
    const a1 = document.querySelector('[data-item-id="a1"]') as HTMLElement;
    expect(a1.getAttribute("draggable")).toBe("true");
    const data = dt();
    fireEvent.dragStart(a1, { dataTransfer: data });
    const wip = screen.getByRole("listitem", { name: "진행중 1" });
    fireEvent.dragOver(wip, { dataTransfer: data });
    expect(wip.classList.contains("is-over")).toBe(true);
    fireEvent.drop(wip, { dataTransfer: data });
    expect(onSetStatus).toHaveBeenCalledWith(expect.objectContaining({ item_id: "a1" }), "in_progress");
    expect(wip.classList.contains("is-over")).toBe(false);

    onSetStatus.mockClear();
    fireEvent.drop(screen.getByRole("listitem", { name: "할 일 1" }), { dataTransfer: data });
    expect(onSetStatus).not.toHaveBeenCalled();
  });

  it("잠긴 계획은 끌 수 없고 상태 메뉴도 없다", () => {
    setup({ locked: true });
    const a1 = document.querySelector('[data-item-id="a1"]') as HTMLElement;
    expect(a1.getAttribute("draggable")).toBe("false");
    expect(within(a1).queryByTitle("상태 바꾸기")).toBeNull();
  });
});
