import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AcpSessionTabs } from "@/features/chat/AcpSessionTabs";

// 2026-08-20 — "새로운 세션을 눌러도 상단 상태창에 아무 것도 안 뜬다".
//
// 세션은 첫 마디를 보낼 때 비로소 생긴다. 그전까지의 빈 화면도 탭 줄에서는
// 자기 자리를 가져야 "새 창이 열렸다"가 읽힌다.

afterEach(cleanup);

describe("AcpSessionTabs — 아직 안 만든 대화", () => {
  it("제목 대신 '새로운 세션' 으로 뜬다", () => {
    render(
      <AcpSessionTabs
        tabs={[{ id: "", title: null, pending: true }]}
        activeId=""
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: "새로운 세션" })).toBeTruthy();
    expect(screen.queryByText("제목 없는 대화")).toBeNull();
  });

  it("열려 있던 대화 옆에서 활성으로 잡힌다", () => {
    render(
      <AcpSessionTabs
        tabs={[
          { id: "s1", title: "지난 대화" },
          { id: "", title: null, pending: true },
        ]}
        activeId=""
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  });

  it("혼자일 때는 닫을 수 없다 — 닫으면 빈 줄만 남는다", () => {
    render(
      <AcpSessionTabs
        tabs={[{ id: "", title: null, pending: true }]}
        activeId=""
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "탭 닫기" })).toBeNull();
  });

  it("돌아갈 대화가 있으면 닫힌다", () => {
    const onClose = vi.fn();
    render(
      <AcpSessionTabs
        tabs={[
          { id: "s1", title: "지난 대화" },
          { id: "", title: null, pending: true },
        ]}
        activeId=""
        onPick={() => {}}
        onClose={onClose}
      />,
    );
    const closers = screen.getAllByRole("button", { name: "탭 닫기" });
    fireEvent.click(closers[closers.length - 1]);
    expect(onClose).toHaveBeenCalledWith("");
  });
});
