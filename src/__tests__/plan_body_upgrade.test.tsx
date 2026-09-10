// 플래너 본문 업그레이드 (2026-09-10) — 다음 할 일 띠 · 남은 것만 · 상태 메뉴.
// "떴다" 가 아니라 **무엇이 적히고 무엇이 불리는가** 를 잰다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PlanBody } from "@/features/planner/PlanBody";
import { countByStatus, leafItems } from "@/features/planner/planMeta";
import type { PlanDetail, PlanItemDto } from "@/lib/bindings";

afterEach(cleanup);

function item(id: string, status: string, phase: string, over: Partial<PlanItemDto> = {}): PlanItemDto {
  return {
    item_id: id, phase, title: `제목 ${id}`, status, order_idx: 0, parent_item: null,
    note: null, last_agent: null, last_update: null, journal_refs: [], ...over,
  };
}

const items: PlanItemDto[] = [
  item("a1", "done", "Phase A"),
  item("a2", "done", "Phase A"),
  item("a3", "blocked", "Phase A"),
  item("b1", "in_progress", "Phase B"),
  item("b2", "todo", "Phase B"),
  item("p", "done", "Phase B"),
  item("c1", "done", "Phase B", { parent_item: "p" }),
  item("c2", "done", "Phase B", { parent_item: "p" }),
];

const detail: PlanDetail = {
  plan: {
    plan_id: "demo", title: "데모 계획", status: "active", owner_agent: "claude-code",
    progress: 4.5 / 7, file_path: ".oculpm/planner/demo.md", updated_at: "2026-09-10",
    item_count: 7, done_count: 4,
  },
  items,
  phases: [
    { phase_id: null, name: "Phase A", status: "in_progress", progress: 2 / 3, item_count: 3, done_count: 2, last_agent: null, last_update: null },
    { phase_id: null, name: "Phase B", status: "in_progress", progress: 2.5 / 4, item_count: 4, done_count: 2, last_agent: null, last_update: null },
  ],
  decisions: [],
  warnings: [],
};

function setup(over: { hideDone?: boolean; locked?: boolean; view?: "doc" | "board" } = {}) {
  const onSetStatus = vi.fn();
  const onHideDoneChange = vi.fn();
  const onDispatch = vi.fn();
  const setCollapsed = vi.fn();
  const phases: [string, PlanItemDto[]][] = [
    ["Phase A", items.filter((i) => i.phase === "Phase A")],
    ["Phase B", items.filter((i) => i.phase === "Phase B")],
  ];
  const utils = render(
    <PlanBody
      detail={detail}
      counts={countByStatus(leafItems(items))}
      phases={phases}
      collapsed={{}}
      setCollapsed={setCollapsed}
      onSetStatus={onSetStatus}
      onDispatch={onDispatch}
      busy={false}
      locked={over.locked ?? false}
      onToggleLock={vi.fn()}
      onArchive={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onRemoveItem={vi.fn()}
      onRenameItem={vi.fn()}
      onRenamePhase={vi.fn()}
      onRemovePhase={vi.fn()}
      onMovePhase={vi.fn()}
      historyFor={null}
      history={null}
      onToggleHistory={vi.fn()}
      onRefresh={vi.fn()}
      onOpenJournalRef={vi.fn()}
      resolveJournalRefs={async () => []}
      hideDone={over.hideDone ?? false}
      onHideDoneChange={onHideDoneChange}
      view={over.view ?? "doc"}
    />,
  );
  return { ...utils, onSetStatus, onHideDoneChange, onDispatch, setCollapsed };
}

describe("플래너 본문 — 숫자가 서로 맞는다", () => {
  it("상태 칩은 리프만 센다 (부모 p 는 빠져 완료 4)", () => {
    setup();
    const counts = document.querySelector(".pln-head-counts")!;
    expect(counts.textContent).toContain("완료 4");
    expect(counts.textContent).toContain("막힘 1");
  });

  it("단계 스트립은 단계마다 한 조각, 막힌 단계에만 붉은 조각", () => {
    setup();
    const strip = screen.getByRole("group", { name: "단계별 진척" });
    const segs = within(strip).getAllByRole("button");
    expect(segs.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Phase A — 2/3 완료, 막힘 1",
      "Phase B — 2/4 완료, 막힘 0",
    ]);
    expect(segs[0].querySelector("i.blocked")).not.toBeNull();
    expect(segs[1].querySelector("i.blocked")).toBeNull();
  });

  it("단계 머리에 done/total 과 막힘 배지", () => {
    setup();
    const heads = document.querySelectorAll(".pln-ph-head");
    expect(heads[0].textContent).toContain("2/3 완료");
    expect(heads[0].querySelector(".phase-blocked")?.textContent).toContain("1");
    expect(heads[1].textContent).toContain("2/4 완료");
    expect(heads[1].querySelector(".phase-blocked")).toBeNull();
  });
});

describe("다음 할 일", () => {
  it("막힘 → 진행중 → 할 일 순으로 싣고, 남은 수를 적는다", () => {
    setup();
    const strip = screen.getByRole("region", { name: "다음 할 일" });
    const rows = within(strip).getAllByTitle(/항목으로 이동/);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("제목 a3"),
      expect.stringContaining("제목 b1"),
      expect.stringContaining("제목 b2"),
    ]);
    expect(strip.textContent).toContain("남은 3");
  });

  it("누르면 그 행이 잠깐 밝혀지고 접힌 단계는 펼친다", () => {
    vi.useFakeTimers();
    try {
      const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
      const { setCollapsed } = setup();
      const strip = screen.getByRole("region", { name: "다음 할 일" });
      fireEvent.click(within(strip).getByTitle(/제목 a3/));
      const row = document.querySelector('[data-item-id="a3"]')!;
      expect(row.classList.contains("is-target")).toBe(true);
      expect(setCollapsed).toHaveBeenCalled();
      vi.advanceTimersByTime(2000);
      expect(row.classList.contains("is-target")).toBe(false);
      raf.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("실행 버튼은 열린 계획에서만", () => {
    const { onDispatch } = setup();
    const strip = screen.getByRole("region", { name: "다음 할 일" });
    fireEvent.click(within(strip).getAllByTitle(/실행/)[0]);
    expect(onDispatch).toHaveBeenCalledWith(expect.objectContaining({ item_id: "a3" }));
    cleanup();
    setup({ locked: true });
    const locked = screen.getByRole("region", { name: "다음 할 일" });
    expect(within(locked).queryAllByTitle(/실행/)).toHaveLength(0);
  });
});

describe("남은 것만", () => {
  it("탭이 setter 를 부른다", () => {
    const { onHideDoneChange } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "남은 것만" }));
    expect(onHideDoneChange).toHaveBeenCalledWith(true);
  });

  it("켜지면 완료 행이 사라지고 단계 발치에 숨긴 수 + 전체 보기", () => {
    const { onHideDoneChange } = setup({ hideDone: true });
    expect(document.querySelector('[data-item-id="a1"]')).toBeNull();
    expect(document.querySelector('[data-item-id="a3"]')).not.toBeNull();
    // Phase B 는 p·c1·c2 셋이 숨는다 (부모는 롤업 done 이라 같이).
    const foots = document.querySelectorAll(".pln-hidden-done");
    expect(foots[0].textContent).toContain("완료 2개 숨김");
    expect(foots[1].textContent).toContain("완료 3개 숨김");
    fireEvent.click(within(foots[1] as HTMLElement).getByText("전체 보기"));
    expect(onHideDoneChange).toHaveBeenCalledWith(false);
  });
});

describe("보드 보기", () => {
  it("문서 본문 대신 열이 뜨고, 남은 것만 토글과 다음 할 일은 접힌다", () => {
    setup({ view: "board" });
    expect(screen.getByRole("list", { name: "보드" })).toBeInTheDocument();
    expect(document.querySelector(".pln-ph-head")).toBeNull();
    expect(screen.queryByRole("tab", { name: "남은 것만" })).toBeNull();
    expect(screen.queryByRole("region", { name: "다음 할 일" })).toBeNull();
    // 머리글(진척 바·집계)은 그대로.
    expect(document.querySelector(".pln-strip")).not.toBeNull();
  });
});

describe("상태 메뉴", () => {
  it("글리프 우클릭 → 여섯 상태, 고르면 onSetStatus", () => {
    const { onSetStatus } = setup();
    const row = document.querySelector('[data-item-id="b2"]')!;
    fireEvent.contextMenu(row.querySelector(".pln-item-glyph")!);
    const menu = screen.getByRole("menu", { name: /제목 b2/ });
    const options = within(menu).getAllByRole("menuitemradio");
    expect(options).toHaveLength(6);
    expect(options.find((o) => o.getAttribute("aria-checked") === "true")?.textContent).toContain("할 일");
    fireEvent.click(within(menu).getByText("막힘"));
    expect(onSetStatus).toHaveBeenCalledWith(expect.objectContaining({ item_id: "b2" }), "blocked");
    expect(screen.queryByRole("menu", { name: /제목 b2/ })).toBeNull();
  });

  it("부모 행에는 메뉴가 없다 — 상태는 롤업", () => {
    setup();
    const row = document.querySelector('[data-item-id="p"]')!;
    fireEvent.contextMenu(row.querySelector(".pln-item-glyph")!);
    expect(screen.queryByRole("menu", { name: /제목 p/ })).toBeNull();
    expect(within(row as HTMLElement).queryByTitle("상태 바꾸기")).toBeNull();
  });
});
