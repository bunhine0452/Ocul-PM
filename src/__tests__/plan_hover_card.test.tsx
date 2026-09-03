// 레일 행 위의 카드 — 좁은 목록이 버린 사실들이 실제로 돌아오는가.
//
// 행은 두 줄이 한계라 제목이 잘리고 상태·작성자·계획 id 는 아예 자리가 없다.
// 카드는 그것들을 되돌려 주는 유일한 창구이므로, "떴다"가 아니라 **무엇이
// 적히는가**를 잰다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlanRail } from "@/features/planner/PlanRail";
import { HOVER_DELAY_MS } from "@/features/planner/PlanHoverCard";
import { facetsOf } from "@/features/planner/planList";
import type { PlanSummary } from "@/lib/bindings";

afterEach(cleanup);

const NOW = Date.parse("2026-09-04T09:00:00+09:00");
const DAY = 86_400_000;

const LONG = "계획이 쌓여도 목록은 짧게 — 플래너 정리·레일 조절";

function plan(over: Partial<PlanSummary> & { plan_id: string }): PlanSummary {
  return {
    plan_id: over.plan_id,
    title: over.title ?? over.plan_id,
    status: over.status ?? "active",
    owner_agent: over.owner_agent ?? "claude-code",
    progress: over.progress ?? 0.25,
    file_path: `.oculpm/planner/${over.plan_id}.md`,
    updated_at: over.updated_at ?? new Date(NOW - DAY).toISOString(),
    item_count: over.item_count ?? 12,
    done_count: over.done_count ?? 3,
  };
}

const plans = [plan({ plan_id: "planner-scale-tidy", title: LONG })];

function setup() {
  const facets = facetsOf(plans, NOW, {
    "planner-scale-tidy": new Date(NOW - DAY).toISOString(),
  });
  return render(
    <PlanRail
      plans={plans}
      facets={facets}
      selectedId={null}
      onSelect={vi.fn()}
      sort="recent"
      onSortChange={vi.fn()}
      group="status"
      onGroupChange={vi.fn()}
      query=""
      onQueryChange={vi.fn()}
      openOverride={{}}
      onToggleSection={vi.fn()}
      now={NOW}
      side="left"
    />,
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function hover(el: Element) {
  fireEvent.pointerEnter(el);
  act(() => {
    vi.advanceTimersByTime(HOVER_DELAY_MS + 20);
  });
}

describe("PlanRail — 행 위의 카드", () => {
  it("얹으면 잘린 제목 전문과 상태·진행·작성자·계획 id 가 나온다", () => {
    setup();
    const row = screen.getByText(LONG).closest("button")!;
    hover(row);

    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent(LONG);
    expect(card).toHaveTextContent("진행 중");
    expect(card).toHaveTextContent("3/12 · 25%");
    expect(card).toHaveTextContent("9개"); // 남은 항목
    expect(card).toHaveTextContent("claude-code");
    expect(card).toHaveTextContent("planner-scale-tidy");
  });

  it("마지막 활동은 상대·절대 시각을 함께 말한다", () => {
    setup();
    hover(screen.getByText(LONG).closest("button")!);
    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent("어제");
    expect(card).toHaveTextContent("2026.09.03");
  });

  it("지연을 넘기기 전에는 뜨지 않는다 — 훑고 지나가는 손에는 방해다", () => {
    setup();
    fireEvent.pointerEnter(screen.getByText(LONG).closest("button")!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY_MS - 60);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("떠나면 사라진다", () => {
    setup();
    const row = screen.getByText(LONG).closest("button")!;
    hover(row);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(row);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("행에는 네이티브 title 을 남기지 않는다 (툴팁 두 개가 겹친다)", () => {
    setup();
    expect(screen.getByText(LONG).closest("button")).not.toHaveAttribute("title");
  });
});

describe("PlanRail — 카드를 닫는 손", () => {
  it("눌러서 닫으면 손이 떠날 때까지 다시 뜨지 않는다 (포커스가 곧바로 되부른다)", () => {
    setup();
    const row = screen.getByText(LONG).closest("button")!;
    hover(row);
    // 누르면 닫힌다 — 그리고 버튼이 포커스를 가져가 다시 부르려 한다.
    fireEvent.pointerDown(row);
    fireEvent.focus(row);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY_MS + 20);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // 떠났다 돌아오면 다시 뜬다.
    fireEvent.pointerLeave(row);
    hover(row);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});
