// 「이 기기에만」 한 줄 (11-13, 두 기기를 오갈 때) — 올리지 않은 것을 수로만 말하고, 없으면 그리지 않는다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LocalOnlyLine } from "@/features/today/TodaySide";

afterEach(cleanup);

describe("이 기기에만", () => {
  it("커밋 안 한 변경 · 그중 기록 · 안 올린 커밋을 한 줄로, 누르면 변경 화면", () => {
    const onOpen = vi.fn();
    const { container } = render(<LocalOnlyLine local={{ uncommitted: 5, records: 2, unpushed: 3 }} onOpen={onOpen} />);
    expect(container.textContent).toContain("이 기기에만 · 커밋 안 한 변경 5 (그중 기록 2) · 안 올린 커밋 3");
    fireEvent.click(screen.getByRole("button", { name: "변경 보기" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("있는 것만 말한다", () => {
    const { container, rerender } = render(<LocalOnlyLine local={{ uncommitted: 0, records: 0, unpushed: 1 }} onOpen={() => {}} />);
    expect(container.textContent).toContain("이 기기에만 · 안 올린 커밋 1");
    expect(container.textContent).not.toContain("커밋 안 한 변경");
    rerender(<LocalOnlyLine local={{ uncommitted: 4, records: 0, unpushed: 0 }} onOpen={() => {}} />);
    expect(container.textContent).toContain("이 기기에만 · 커밋 안 한 변경 4");
    expect(container.textContent).not.toContain("그중 기록");
  });

  it("다 올렸거나 리모트가 없으면(null) 그리지 않는다", () => {
    const { container, rerender } = render(<LocalOnlyLine local={{ uncommitted: 0, records: 0, unpushed: 0 }} onOpen={() => {}} />);
    expect(container.textContent).toBe("");
    rerender(<LocalOnlyLine local={null} onOpen={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
