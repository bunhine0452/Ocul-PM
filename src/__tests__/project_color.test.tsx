// 프로젝트 색 (2026-11-03) — 창 여럿 사이에서 어느 프로젝트인지 윗줄 색 · 목록 점으로 가린다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { setColor, openIds, tile } = vi.hoisted(() => ({
  setColor: vi.fn(async (_id: number, _c: string | null) => "applied" as const),
  openIds: vi.fn(async (): Promise<number[]> => []),
  tile: vi.fn(async () => 2),
}));
vi.mock("@/api/projects", () => ({ projectsApi: { brief: async () => null, setColor } }));
vi.mock("@/api/terminal", () => ({
  terminalApi: { overview: async () => [], onSessionsChanged: async () => () => {} },
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    openProjectIds: openIds,
    tile,
    attention: async () => new Map(),
    onAttentionChanged: async () => () => {},
  },
}));

import { ProjectSwitcher } from "@/features/shell/ProjectSwitcher";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import { projectColorOf } from "@/features/shell/projectColor";
import { accentFor } from "@/features/theme/projectAccent";
import type { Project } from "@/lib/bindings";

const projects = [
  { id: 1, name: "a", root_path: "/a", created_at: 2, icon: null, color: "blue" },
  { id: 2, name: "b", root_path: "/b", created_at: 1, icon: null, color: null },
] as Project[];

afterEach(() => {
  cleanup();
  setColor.mockClear();
  tile.mockClear();
  openIds.mockReset();
  openIds.mockResolvedValue([]);
});

describe("프로젝트 색", () => {
  it("아는 id 만 색이다 — 없음 · 옛 값은 색 없음", () => {
    expect(projectColorOf("blue")).toBe("blue");
    expect(projectColorOf(null)).toBeUndefined();
    expect(projectColorOf("#ff0000")).toBeUndefined();
  });

  it("이름 앞에 이 프로젝트의 색 점, 목록에서 색을 고르면 저장하고 목록을 다시 읽는다", async () => {
    const onProjectsChanged = vi.fn();
    const { container } = render(
      <ProjectSwitcher
        projectName="a"
        currentProjectId={1}
        projects={projects}
        onOpenProject={() => {}}
        onProjectsChanged={onProjectsChanged}
      />,
    );
    expect(container.querySelector(".proj-switch .proj-dot")?.getAttribute("data-pc")).toBe("blue");

    fireEvent.click(container.querySelector(".proj-switch")!);
    // 열 때 목록을 다시 읽는다 — 다른 창에서 바꾼 색이 따라오게.
    expect(onProjectsChanged).toHaveBeenCalledTimes(1);
    const blue = await screen.findByRole("menuitemradio", { name: "파랑" });
    expect(blue.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "주황" }));
    await waitFor(() => expect(setColor).toHaveBeenCalledWith(1, "orange"));
    await waitFor(() => expect(onProjectsChanged).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("menuitemradio", { name: "색 없음" }));
    await waitFor(() => expect(setColor).toHaveBeenCalledWith(1, null));
  });

  it("VS Code 의 settings.json 에 주석이 있어 못 고치면 그렇다고 말한다", async () => {
    setColor.mockResolvedValueOnce("skipped" as never);
    const info = vi.spyOn(toast, "info");
    const { container } = render(
      <ProjectSwitcher projectName="a" currentProjectId={1} projects={projects} onOpenProject={() => {}} />,
    );
    fireEvent.click(container.querySelector(".proj-switch")!);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "청록" }));
    await waitFor(() => expect(info).toHaveBeenCalledWith(t("sidebar.projectColorVscodeSkipped")));
    info.mockRestore();
  });

  it("프로젝트 색이 있으면 그 창의 강조색이 된다 — 없으면 설정의 강조색", () => {
    expect(accentFor("blue", "teal")).toBe("blue");
    expect(accentFor("violet", "green")).toBe("purple");
    expect(accentFor("amber", "green")).toBe("amber");
    expect(accentFor(undefined, "teal")).toBe("teal");
  });

  it("창이 둘 이상 열려 있으면 「나란히 놓기」 가 서고, 누르면 창을 세운다", async () => {
    openIds.mockResolvedValue([1, 2]);
    const { container } = render(
      <ProjectSwitcher projectName="a" currentProjectId={1} projects={projects} onOpenProject={() => {}} />,
    );
    fireEvent.click(container.querySelector(".proj-switch")!);
    const item = await screen.findByRole("menuitem", { name: /창 2개 나란히 놓기/ });
    fireEvent.click(item);
    await waitFor(() => expect(tile).toHaveBeenCalledTimes(1));
  });

  it("창이 하나뿐이면 「나란히 놓기」 는 없다", async () => {
    openIds.mockResolvedValue([1]);
    const { container } = render(
      <ProjectSwitcher projectName="a" currentProjectId={1} projects={projects} onOpenProject={() => {}} />,
    );
    fireEvent.click(container.querySelector(".proj-switch")!);
    await screen.findByRole("menuitemradio", { name: "파랑" });
    expect(screen.queryByRole("menuitem", { name: /나란히/ })).toBeNull();
  });
});
