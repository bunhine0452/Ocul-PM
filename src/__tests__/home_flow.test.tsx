import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, findByText, render, fireEvent } from "@testing-library/react";

// ─── 메인 화면 "오늘의 흐름" ─────────────────────────────────────────────
//
// 두 가지가 계약이다:
//  1. **행을 누르면 그 일지가 열린다.** 예전에는 프로젝트만 열고 일지 경로를
//     버렸다 — 목록에서 고른 항목이 화면 어디에도 나타나지 않았다.
//  2. **오늘이 아닌 항목은 날짜를 밝힌다.** 피드는 날짜로 자르지 않으므로
//     (`home.rs` Q4) 어제 것이 섞여 드는데, 시각만 적으면 헤더의 "오늘 N건"
//     아래에서 전부 오늘 일로 읽힌다.

const BRIEF = {
  projects: [],
  today_workday: "20260902",
  since_workday: "20260820",
  today_total: 38,
  active_projects: 2,
  feed: [
    {
      project_id: 1,
      relative_path: "journal/20260902/Bug/1732-terminal.md",
      workday: "20260902",
      created_at: "2026-09-02T17:32:10+09:00",
      title: "터미널을 켜 두기만 해도 뜨던 탭 닫기 경고",
      type: "bug",
      agent_id: "claude-code",
      agent_version: null,
    },
    {
      project_id: 2,
      relative_path: "journal/20260901/Feature/1015-logo.md",
      workday: "20260901",
      created_at: "2026-09-01T10:15:00+09:00",
      title: "로고 마크 전면 재설계",
      type: "feature",
      agent_id: "claude-code",
      agent_version: null,
    },
  ],
};

vi.mock("@/lib/bindings", () => ({
  commands: {
    listBlueprints: () => Promise.resolve({ status: "ok", data: [] }),
    deleteBlueprint: () => Promise.resolve({ status: "ok", data: null }),
    homeBrief: () => Promise.resolve({ status: "ok", data: BRIEF }),
  },
}));

import { StartScreen, type StartScreenProps } from "@/features/onboarding/StartScreen";
import { dayLabel } from "@/features/onboarding/home/homeModel";
import {
  consumeEntryJump,
  onEntryJump,
  requestEntryJump,
  resetEntryJump,
} from "@/lib/entryJump";

function project(over: Partial<StartScreenProps["projects"][number]> = {}) {
  return {
    id: 1,
    name: "Ocul-PM",
    root_path: "/x/ocul-pm",
    created_at: 0,
    icon: null,
    color: null,
    theme_id: null,
    ...over,
  };
}

function renderStart(over: Partial<StartScreenProps> = {}) {
  const props: StartScreenProps = {
    projects: [project(), project({ id: 2, name: "after_coding", root_path: "/x/after" })],
    indexingId: null,
    openWindows: [],
    error: null,
    onSelectProject: vi.fn(),
    onOpenEntry: vi.fn(),
    onAddProject: vi.fn(),
    onRenameProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onOpenSettings: vi.fn(),
    onStartGreenfield: vi.fn(),
    onResumeBlueprint: vi.fn(),
    onProjectsChanged: vi.fn(),
    ...over,
  };
  return { ...render(<StartScreen {...props} />), props };
}

afterEach(() => {
  cleanup();
  resetEntryJump();
});

describe("오늘의 흐름 — 행 클릭", () => {
  it("일지 경로까지 실어 연다 (프로젝트만 여는 게 아니다)", async () => {
    const { container, props } = renderStart();
    const row = await findByText(
      container as HTMLElement,
      "터미널을 켜 두기만 해도 뜨던 탭 닫기 경고",
    );
    fireEvent.click(row);
    expect(props.onOpenEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: "Ocul-PM" }),
      "journal/20260902/Bug/1732-terminal.md",
    );
  });

  it("오늘 항목은 시각만, 어제 항목은 날짜를 함께 적는다", async () => {
    const { container } = renderStart();
    expect(await findByText(container as HTMLElement, "17:32")).toBeInTheDocument();
    expect(await findByText(container as HTMLElement, "9/1 10:15")).toBeInTheDocument();
  });
});

describe("dayLabel", () => {
  it("오늘이면 꼬리표를 달지 않는다", () => {
    expect(dayLabel("20260902", "20260902")).toBeNull();
  });

  it("다른 날이면 M/D — 앞의 0 은 떼고", () => {
    expect(dayLabel("20260901", "20260902")).toBe("9/1");
    expect(dayLabel("20251231", "20260902")).toBe("12/31");
  });

  it("형식이 어긋나면 조용히 없는 셈 친다", () => {
    expect(dayLabel("", "20260902")).toBeNull();
    expect(dayLabel("2026-09-01", "20260902")).toBeNull();
  });
});

describe("entryJump — 승격 사이를 건너는 요청", () => {
  it("아직 셸이 없으면 마운트 때 회수된다", () => {
    requestEntryJump(7, "journal/a.md");
    expect(consumeEntryJump(7)).toBe("journal/a.md");
    // 한 번만 — 다음 마운트가 같은 일지를 또 열면 안 된다.
    expect(consumeEntryJump(7)).toBeNull();
  });

  it("남의 프로젝트 앞으로 온 요청은 삼키지 않는다", () => {
    requestEntryJump(7, "journal/a.md");
    expect(consumeEntryJump(9)).toBeNull();
    expect(consumeEntryJump(7)).toBe("journal/a.md");
  });

  it("이미 떠 있는 셸은 구독으로 받고, 자기 것만 받는다", () => {
    const mine = vi.fn();
    const other = vi.fn();
    const offMine = onEntryJump(7, mine);
    const offOther = onEntryJump(9, other);

    requestEntryJump(7, "journal/a.md");

    expect(mine).toHaveBeenCalledWith("journal/a.md");
    expect(other).not.toHaveBeenCalled();
    // 구독이 소비했으므로 뒤늦게 마운트되는 화면이 다시 열지 않는다.
    expect(consumeEntryJump(7)).toBeNull();

    offMine();
    offOther();
  });
});
