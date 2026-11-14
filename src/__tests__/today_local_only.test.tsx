// 날짜 줄의 수 (11-13 두 기기 → 11-15 한 줄) — 이 기기에만 · 받아 온 것을 수로만 말하고, 0 이면 그리지 않는다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TodayNumbers } from "@/features/today/TodaySide";
import type { Arrived, LocalOnly } from "@/lib/bindings";

afterEach(cleanup);

const NOW = 1_800_000_000_000;
const daysAgo = (n: number) => Math.floor(NOW / 1000) - n * 86_400;
const fns = () => ({ onOpenPlan: vi.fn(), onOpenEntry: vi.fn(), onOpenDiff: vi.fn(), onHandOff: vi.fn() });
const nums = (local: LocalOnly | null, arrived: Arrived | null, on = fns()) =>
  render(<TodayNumbers mine={[]} plans={[]} arrived={arrived} local={local} now={NOW} opening={false} {...on} />);

describe("이 기기에만", () => {
  it("커밋 안 한 일지 · 계획 파일 수를 말하고, 누르면 변경 화면 · 곁의 「올리기 맡기기」 는 Claude 에게", () => {
    const on = fns();
    nums({ uncommitted: 5, records: 2, unpushed: 3 }, null, on);
    const n = screen.getByRole("button", { name: "이 기기에만 2" });
    expect(n.title).toContain("커밋 안 한 파일 5 · 그중 일지와 계획 2 · 안 올린 커밋 3");
    fireEvent.click(n);
    expect(on.onOpenDiff).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "올리기 맡기기" }));
    expect(on.onHandOff).toHaveBeenCalledTimes(1);
  });

  it("커밋 안 한 코드나 안 올린 커밋만으로는 서지 않는다 — 일하는 내내 서 있던 줄이었다", () => {
    const { container, rerender } = nums({ uncommitted: 4, records: 0, unpushed: 0 }, null);
    expect(container.textContent).toBe("");
    rerender(<TodayNumbers mine={[]} plans={[]} arrived={null} local={{ uncommitted: 0, records: 0, unpushed: 1 }} now={NOW} opening={false} {...fns()} />);
    expect(container.textContent).toBe("");
  });

  it("리모트가 없으면(null) 그리지 않는다", () => {
    expect(nums(null, null).container.textContent).toBe("");
  });
});

describe("받아 온 것", () => {
  it("오늘 받아 온 일지 수를 말하고, 누르면 가장 최근 것을 연다", () => {
    const on = fns();
    nums(null, { journals: ["20261112/Bugs/b.md", "20261111/Chores/a.md"], synced_at: daysAgo(0) }, on);
    fireEvent.click(screen.getByRole("button", { name: "받아 온 일지 2" }));
    expect(on.onOpenEntry).toHaveBeenCalledWith("20261112/Bugs/b.md");
  });

  it("받아 온 일지가 없으면, 주고받은 지 하루가 넘었을 때만 날수를 말한다(누를 곳은 없다)", () => {
    const { container, rerender } = nums(null, { journals: [], synced_at: daysAgo(3) });
    expect(container.textContent).toBe("올리거나 받아 온 지 3일");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<TodayNumbers mine={[]} plans={[]} arrived={{ journals: [], synced_at: daysAgo(0) - 3600 * 20 }} local={null} now={NOW} opening={false} {...fns()} />);
    expect(container.textContent).toBe("");
  });

  it("다른 곳의 기록을 받은 적이 없는 저장소(synced_at 없음)와 모름(null)은 그리지 않는다", () => {
    expect(nums(null, { journals: [], synced_at: null }).container.textContent).toBe("");
    cleanup();
    expect(nums(null, null).container.textContent).toBe("");
  });
});
