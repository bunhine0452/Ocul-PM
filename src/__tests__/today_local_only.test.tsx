// 「이 기기에만」 한 줄 (11-13, 두 기기를 오갈 때) — 올리지 않은 것을 수로만 말하고, 없으면 그리지 않는다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ArrivedLine, LocalOnlyLine } from "@/features/today/TodaySide";

afterEach(cleanup);

describe("이 기기에만", () => {
  it("커밋 안 한 변경 · 그중 기록 · 안 올린 커밋을 한 줄로, 누르면 변경 화면", () => {
    const onOpen = vi.fn();
    const onHandOff = vi.fn();
    const { container } = render(<LocalOnlyLine local={{ uncommitted: 5, records: 2, unpushed: 3 }} onOpen={onOpen} onHandOff={onHandOff} />);
    expect(container.textContent).toContain("이 기기에만 · 커밋 안 한 변경 5 (그중 기록 2) · 안 올린 커밋 3");
    fireEvent.click(screen.getByRole("button", { name: "변경 보기" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "올리기 맡기기" }));
    expect(onHandOff).toHaveBeenCalledTimes(1);
  });

  it("있는 것만 말한다", () => {
    const { container, rerender } = render(<LocalOnlyLine local={{ uncommitted: 0, records: 0, unpushed: 1 }} onOpen={() => {}} onHandOff={() => {}} />);
    expect(container.textContent).toContain("이 기기에만 · 안 올린 커밋 1");
    expect(container.textContent).not.toContain("커밋 안 한 변경");
    rerender(<LocalOnlyLine local={{ uncommitted: 4, records: 0, unpushed: 0 }} onOpen={() => {}} onHandOff={() => {}} />);
    expect(container.textContent).toContain("이 기기에만 · 커밋 안 한 변경 4");
    expect(container.textContent).not.toContain("그중 기록");
  });

  it("다 올렸거나 리모트가 없으면(null) 그리지 않는다", () => {
    const { container, rerender } = render(<LocalOnlyLine local={{ uncommitted: 0, records: 0, unpushed: 0 }} onOpen={() => {}} onHandOff={() => {}} />);
    expect(container.textContent).toBe("");
    rerender(<LocalOnlyLine local={null} onOpen={() => {}} onHandOff={() => {}} />);
    expect(container.textContent).toBe("");
  });
});

// 「받아 온 것」 한 줄 (11-13) — 다른 곳에서 쓴 일지가 오늘 들어왔으면 그 수, 아니면 오래 안 주고받았을 때의 날수.
describe("받아 온 것", () => {
  const NOW = 1_800_000_000_000;
  const daysAgo = (n: number) => Math.floor(NOW / 1000) - n * 86_400;

  it("오늘 받아 온 일지 수를 말하고, 누르면 가장 최근 것을 연다", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <ArrivedLine arrived={{ journals: ["20261112/Bugs/b.md", "20261111/Chores/a.md"], synced_at: daysAgo(0) }} now={NOW} onOpen={onOpen} />,
    );
    expect(container.textContent).toContain("오늘 받아 온 일지 2건");
    fireEvent.click(screen.getByRole("button", { name: "일지 보기" }));
    expect(onOpen).toHaveBeenCalledWith("20261112/Bugs/b.md");
  });

  it("받아 온 일지가 없으면, 주고받은 지 하루가 넘었을 때만 날수를 말한다", () => {
    const { container, rerender } = render(<ArrivedLine arrived={{ journals: [], synced_at: daysAgo(3) }} now={NOW} onOpen={() => {}} />);
    expect(container.textContent).toContain("리모트와 주고받은 지 3일");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ArrivedLine arrived={{ journals: [], synced_at: daysAgo(0) - 3600 * 20 }} now={NOW} onOpen={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("다른 곳의 기록을 받은 적이 없는 저장소(synced_at 없음)와 모름(null)은 그리지 않는다", () => {
    const { container, rerender } = render(<ArrivedLine arrived={{ journals: [], synced_at: null }} now={NOW} onOpen={() => {}} />);
    expect(container.textContent).toBe("");
    rerender(<ArrivedLine arrived={null} now={NOW} onOpen={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
