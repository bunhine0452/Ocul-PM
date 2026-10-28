import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { SourceFilterRail } from "@/features/oculpm/SourceBadge";

// 출처 레일 (Osaurus 라운드 Phase 3). 레일은 출처가 1종이면 **아예 렌더되지 않는다** (빈 필터는
// 소음). 활성 행·인라인 Stop 의 계약은 ACP 화면과 함께 걷었다 (2026-10-28).

afterEach(() => {
  cleanup();
});

describe("출처 필터 레일", () => {
  it("출처가 1종이면 그리지 않는다", () => {
    const { container } = render(
      <SourceFilterRail sources={["agent", "agent"]} value={null} onChange={() => {}} />,
    );
    expect(container.querySelector("[role=radiogroup]")).toBeNull();
  });

  it("2종 이상이면 전체 + 나타난 출처만 그린다 (없는 출처는 칩도 없다)", () => {
    render(
      <SourceFilterRail
        sources={["agent", "direct", "agent"]}
        counts={{ agent: 2, direct: 1 }}
        value={null}
        onChange={() => {}}
      />,
    );
    const rail = screen.getByRole("radiogroup");
    const chips = within(rail).getAllByRole("radio");
    expect(chips.map((c) => c.textContent)).toEqual(["전체3", "직접1", "에이전트2"]);
    expect(within(rail).queryByText("스케줄")).toBeNull();
  });

  it("고른 출처만 aria-checked 다 (배타 선택)", () => {
    const picked: (string | null)[] = [];
    render(
      <SourceFilterRail
        sources={["agent", "schedule"]}
        value="schedule"
        onChange={(next) => picked.push(next)}
      />,
    );
    const rail = screen.getByRole("radiogroup");
    const checked = within(rail)
      .getAllByRole("radio")
      .filter((c) => c.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent).toContain("스케줄");

    fireEvent.click(within(rail).getByText(/전체/));
    expect(picked).toEqual([null]);
  });
});
