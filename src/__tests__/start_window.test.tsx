/**
 * 시작 창 (4.0) — 최근 프로젝트 한 칸.
 *
 * 무는 것: 「열기」는 **이 창이** 그 프로젝트가 되는 것이다(`set_window_project`). 폴더를 새로
 * 고르면 곧바로 그 프로젝트가 된다 — 「처음 쓰는 방법」 세 단계 칸은 첫 실행 안내가 대신한다
 * (ocul-next #tour-retire).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";

import type { Project } from "@/lib/bindings";

const fx = vi.hoisted(() => ({
  projects: [] as Project[],
  picked: null as string | null,
  adopt: vi.fn(async (_id: number) => true),
  create: vi.fn(async (_name: string, _root: string) => 0),
  forget: vi.fn(async (_id: number) => null),
  init: vi.fn(async (_id: number) => ({})),
  watcherStart: vi.fn(async (_id: number) => null),
  journalAdded: [] as Array<(projectId: number) => void>,
}));

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/projects", () => ({
  projectsApi: {
    list: async () => fx.projects,
    pickFolder: async () => fx.picked,
    create: fx.create,
    forget: fx.forget,
    brief: async () => ({
      projects: [
        { project_id: 1, total_entries: 9, last_at: "2026-10-29T09:00:00Z", last_workday: todayKey(), today_count: 58, days: [] },
      ],
      today_workday: todayKey(),
      since_workday: todayKey(),
      today_total: 58,
      active_projects: 1,
      feed: [],
    }),
    onJournalAdded: (cb: (id: number) => void) => {
      fx.journalAdded.push(cb);
      return Promise.resolve(() => {});
    },
  },
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    adoptProject: fx.adopt,
    openProjectIds: async () => [],
    onOpenProjectsChanged: () => Promise.resolve(() => {}),
  },
}));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    init: fx.init,
    watcherStart: fx.watcherStart,
    compareWorkday: async () => ({ workday: "", sessions: [{ unrecorded: ["a.ts", "b.ts", "c.ts", "d.ts"] }], unrecorded_total: 4 }),
  },
}));

import { StartWindow } from "@/features/start/StartWindow";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import { localWorkdayKey } from "@/lib/workday";

function todayKey() {
  return localWorkdayKey();
}

const project = (id: number, name: string, root: string): Project => ({
  id,
  name,
  root_path: root,
  created_at: id,
  icon: null,
  color: null,
});

beforeEach(() => {
  setLangSetting("ko");
  fx.projects = [];
  fx.picked = null;
  fx.journalAdded.length = 0;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetLangForTests();
});

describe("최근 프로젝트", () => {
  it("줄마다 이름 · ~ 경로 · 오늘 기록 수 · 확인할 것, 「열기」는 이 창을 그 프로젝트로", async () => {
    fx.projects = [project(1, "ai-pm", "/Users/me/Desktop/git/ai-pm")];
    render(<StartWindow />);
    const recent = screen.getByRole("region", { name: t("start.recent") });
    const row = await within(recent).findByText("ai-pm");
    const li = row.closest("li")!;
    expect(within(li).getByText("~/Desktop/git/ai-pm")).toBeInTheDocument();
    expect(await within(li).findByText(t("start.today", { n: 58 }))).toBeInTheDocument();
    expect(await within(li).findByText(t("start.toCheck", { n: 4 }))).toHaveClass("warn");
    fireEvent.click(within(li).getByRole("button", { name: t("start.openAria", { name: "ai-pm" }) }));
    expect(fx.adopt).toHaveBeenCalledWith(1);
  });

  it("프로젝트가 없으면 폴더를 열라고 한 문장으로 말한다 — 세 단계 칸은 없다", async () => {
    render(<StartWindow />);
    expect(await screen.findByText(t("start.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: t("tour.title") })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  });

  it("목록에서 빼기는 묻고 나서 뺀다 — 기본은 폴더 그대로, 체크하면 기록 폴더를 휴지통으로", async () => {
    fx.projects = [project(3, "old", "/Users/me/old")];
    render(<StartWindow />);
    fireEvent.click(await screen.findByRole("button", { name: t("start.forgetAria", { name: "old" }) }));
    fireEvent.click(await screen.findByRole("button", { name: t("start.forget") }));
    await waitFor(() => expect(fx.forget).toHaveBeenCalledWith(3, false));

    fireEvent.click(await screen.findByRole("button", { name: t("start.forgetAria", { name: "old" }) }));
    fireEvent.click(await screen.findByRole("checkbox", { name: new RegExp(t("start.forgetWipe").replace(/[().]/g, "\\$&")) }));
    fireEvent.click(await screen.findByRole("button", { name: t("start.forget") }));
    await waitFor(() => expect(fx.forget).toHaveBeenLastCalledWith(3, true));
  });
});

describe("폴더 열기", () => {
  it("새 폴더를 고르면 등록하고 곧바로 이 창이 그 프로젝트가 된다", async () => {
    fx.picked = "/Users/me/dev/naeri";
    fx.create.mockImplementationOnce(async () => {
      fx.projects = [project(7, "naeri", "/Users/me/dev/naeri")];
      return 7;
    });
    render(<StartWindow />);
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("start.openFolder")) })[0]);
    await waitFor(() => expect(fx.adopt).toHaveBeenCalledWith(7));
    expect(fx.create).toHaveBeenCalledWith("naeri", "/Users/me/dev/naeri");
    // 기록 파일은 프로젝트 창이 열리며 만든다 — 시작 창은 init 을 부르지 않는다.
    expect(fx.init).not.toHaveBeenCalled();
  });

  it("이미 들인 폴더를 다시 고르면 바로 연다", async () => {
    fx.projects = [project(4, "godgame", "/Users/me/godgame")];
    fx.picked = "/Users/me/godgame/";
    render(<StartWindow />);
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("start.openFolder")) })[0]);
    await waitFor(() => expect(fx.adopt).toHaveBeenCalledWith(4));
    expect(fx.create).not.toHaveBeenCalled();
  });

  it("⌘O 가 폴더 열기다", async () => {
    render(<StartWindow />);
    await act(async () => void fireEvent.keyDown(window, { key: "o", metaKey: true }));
    // 고르기 창을 취소했다 (picked = null) — 아무것도 바뀌지 않는다.
    expect(fx.create).not.toHaveBeenCalled();
  });

  it("a11y — axe 위반이 없다", async () => {
    fx.projects = [project(1, "ai-pm", "/Users/me/ai-pm")];
    const { container } = render(<StartWindow />);
    await screen.findByText("ai-pm");
    const results = await axe(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
