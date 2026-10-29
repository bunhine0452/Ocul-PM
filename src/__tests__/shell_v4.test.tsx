/**
 * 4.0 셸 — 사이드바 넷 + 설정, 다섯 화면 라우터, ⌘1~⌘4, ⌘O 최근 프로젝트, 배지.
 *
 * 화면 넷은 다른 레인이 다시 그리는 중이라 여기서는 **이름표만 그리는 대역**으로
 * 바꿔 끼운다 — 이 스위트가 무는 것은 셸의 배선(어느 화면이 언제 서는가)이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";

const fx = vi.hoisted(() => ({
  openProjectWindow: vi.fn(async (_id: number) => null),
  openIds: [] as number[],
}));

vi.mock("@/lib/bindings", () => ({
  commands: new Proxy({}, { get: () => () => Promise.resolve({ status: "ok", data: null }) }),
  events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
}));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "onFileChanged"
          ? () => Promise.resolve(() => {})
          : prop === "compareWorkday"
            ? async () => ({ workday: "20261029", sessions: [{ unrecorded: ["a.ts", "b.ts"] }], unrecorded_total: 2 })
            : prop === "listJournalEntries"
              ? async () => [{}, {}, {}]
              : async () => null,
    },
  ),
}));
vi.mock("@/api/window", () => ({
  windowApi: {
    openProjectWindow: fx.openProjectWindow,
    openProjectIds: async () => fx.openIds,
  },
}));
vi.mock("@/api/projects", () => ({
  projectsApi: {
    brief: async () => ({ projects: [], today_workday: "20261029", since_workday: "20261029", today_total: 0, active_projects: 0, feed: [] }),
    onJournalAdded: () => Promise.resolve(() => {}),
  },
}));
vi.mock("@/features/today/TodayScreenV2", () => ({ TodayScreenV2: () => <div data-testid="screen">today</div> }));
vi.mock("@/features/oculpm/JournalScreenV2", () => ({ JournalScreenV2: () => <div data-testid="screen">journal</div> }));
vi.mock("@/features/planner/PlannerScreenV2", () => ({ PlannerScreenV2: () => <div data-testid="screen">planner</div> }));
vi.mock("@/features/diff/DiffScreenV2", () => ({ DiffScreenV2: () => <div data-testid="screen">diff</div> }));
vi.mock("@/features/settings/SettingsPage", () => ({ SettingsPage: () => <div data-testid="screen">settings</div> }));

import ShellV2 from "@/features/shell/ShellV2";
import { TopBar } from "@/features/shell/TopBar";
import { navBadgesOf } from "@/features/shell/useNavBadges";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useUiPrefs } from "@/contexts/WorkspaceContext";
import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import type { Project } from "@/lib/bindings";

const PROJECTS: Project[] = [
  { id: 1, name: "ai-pm", root_path: "/Users/me/ai-pm", created_at: 1, icon: null, color: null },
  { id: 2, name: "naeri", root_path: "/Users/me/naeri", created_at: 2, icon: null, color: null },
];

/** 셸 + 전역 단축키 — ProjectWindow 가 하는 배선 그대로(팔레트만 뺐다). */
function Harness() {
  const { setUiV2View } = useUiPrefs();
  useGlobalShortcuts({ onOpenPalette: () => {}, uiV2Nav: setUiV2View });
  return (
    <ShellV2
      projectName="ai-pm"
      projectRoot="/Users/me/ai-pm"
      projects={PROJECTS}
      onOpenProject={(id) => void fx.openProjectWindow(id)}
    />
  );
}

async function mountShell() {
  const r = render(
    <WorkspaceProvider projectId={1}>
      <Harness />
    </WorkspaceProvider>,
  );
  await act(async () => {});
  return r;
}

const current = () => screen.getByTestId("screen").textContent;

beforeEach(() => {
  localStorage.clear();
  setLangSetting("ko");
  fx.openIds = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetLangForTests();
});

describe("윗줄 — 프로젝트 · 탭 넷 · 찾기 · 설정 (사이드바 없음)", () => {
  it("탭은 오늘 · 작업 일지 · 계획 · 변경이고, 설정은 윗줄 끝의 톱니다", async () => {
    const { container } = await mountShell();
    // 사이드바는 없다 — 그 옆에 목록 칸이 또 서면 왼쪽이 두 겹이었다.
    expect(container.querySelector("nav.sidebar")).toBeNull();
    const nav = screen.getByRole("navigation", { name: t("nav.aria.main") });
    const labels = within(nav)
      .getAllByRole("button")
      .map((b) => b.querySelector(".topnav-label")?.textContent);
    expect(labels).toEqual(["오늘", "작업 일지", "계획", "변경"]);
    expect(screen.getByRole("button", { name: t("sidebar.settings") })).toBeInTheDocument();
    // 머리는 프로젝트 이름 버튼 하나 — 최근 프로젝트 목록을 띄운다.
    expect(screen.getByRole("button", { name: t("sidebar.switchProjectAria", { name: "ai-pm" }) })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
  });

  it("배지는 예외만 — 확인할 것은 경고색, 오늘 기록 수는 조용한 색", async () => {
    render(
      <TopBar
        view="today"
        onNavigate={() => {}}
        projectName="ai-pm"
        currentProjectId={1}
        projects={PROJECTS}
        onOpenProject={() => {}}
        badges={navBadgesOf(2)}
        slotRef={() => {}}
      />,
    );
    const today = screen.getByRole("button", { name: /오늘/ });
    expect(today.querySelector(".nav-badge")?.textContent).toBe("2");
    // 작업 일지에는 수가 없다 — 오늘 기록 수는 예외가 아니다.
    expect(screen.getByRole("button", { name: /작업 일지/ }).querySelector(".nav-badge")).toBeNull();
    expect(screen.getByRole("button", { name: /변경/ }).querySelector(".nav-badge")?.textContent).toBe("2");
    expect(screen.getByRole("button", { name: /계획/ }).querySelector(".nav-badge")).toBeNull();
  });

  it("a11y — axe 위반이 없다", async () => {
    const { container } = await mountShell();
    const results = await axe(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("라우터 — 다섯 화면", () => {
  it("윗줄 탭을 누르면 그 화면이 서고, 활성 탭이 aria-current 를 갖는다", async () => {
    await mountShell();
    expect(current()).toBe("today");
    for (const [label, view] of [
      ["작업 일지", "journal"],
      ["계획", "planner"],
      ["변경", "diff"],
      ["설정", "settings"],
      ["오늘", "today"],
    ] as const) {
      const row =
        view === "settings"
          ? screen.getByRole("button", { name: t("sidebar.settings") })
          : screen.getAllByRole("button").find((b) => b.querySelector(".topnav-label")?.textContent === label)!;
      fireEvent.click(row);
      expect(await screen.findByText(view)).toBeInTheDocument();
      expect(row).toHaveAttribute("aria-current", "page");
    }
  });

  it("⌘1~⌘4 는 탭 순서, ⌘, 는 설정, ⌘5 는 아무것도 아니다", async () => {
    await mountShell();
    const press = (key: string) => act(() => void fireEvent.keyDown(window, { key, metaKey: true }));
    press("2");
    expect(current()).toBe("journal");
    press("3");
    expect(current()).toBe("planner");
    press("4");
    expect(current()).toBe("diff");
    press(",");
    expect(await screen.findByText("settings")).toBeInTheDocument();
    press("1");
    expect(current()).toBe("today");
    press("5");
    expect(current()).toBe("today");
  });
});

describe("⌘O — 최근 프로젝트 목록", () => {
  it("⌘O 가 목록을 열고, 다른 프로젝트를 고르면 그 프로젝트의 창을 연다", async () => {
    fx.openIds = [2];
    await mountShell();
    await act(async () => void fireEvent.keyDown(window, { key: "o", metaKey: true }));
    const menu = await screen.findByRole("menu", { name: t("sidebar.switchProjectMenu") });
    const items = within(menu).getAllByRole("menuitem");
    // 두 프로젝트 + 「폴더 열기…」.
    expect(items).toHaveLength(3);
    const other = items.find((b) => b.textContent?.includes("naeri"))!;
    // 다른 창에 이미 열려 있으면 「열림」 — 고르면 그 창이 앞으로 온다(백엔드가 판단).
    expect(await within(other).findByText(t("sidebar.openProject"))).toBeInTheDocument();
    fireEvent.click(other);
    expect(fx.openProjectWindow).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("지금 프로젝트를 고르면 아무 창도 열지 않는다 — 이 창의 프로젝트는 바뀌지 않는다", async () => {
    await mountShell();
    fireEvent.click(screen.getByRole("button", { name: t("sidebar.switchProjectAria", { name: "ai-pm" }) }));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getAllByRole("menuitem").find((b) => b.textContent?.includes("ai-pm"))!);
    expect(fx.openProjectWindow).not.toHaveBeenCalled();
  });

  it("Esc 로 닫으면 포커스가 이름 버튼으로 돌아간다", async () => {
    await mountShell();
    const head = screen.getByRole("button", { name: t("sidebar.switchProjectAria", { name: "ai-pm" }) });
    fireEvent.click(head);
    await screen.findByRole("menu");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(head);
  });
});

describe("배지 수", () => {
  it("0 과 모름은 배지가 없다 — 오늘 칸은 오늘 화면의 예외 수를 받는다", () => {
    expect(navBadgesOf(0)).toEqual({});
    expect(navBadgesOf(null)).toEqual({});
    // 오늘 화면의 예외 목록 길이가 오면 그것이 오늘 칸이다 (변경 칸은 그대로 미기록 파일).
    expect(navBadgesOf(2, 5)).toEqual({ today: { n: 5 }, diff: { n: 2 } });
    // 예외 수를 「모름」으로 받으면 오늘 칸을 비운다 — 미기록 수로 대신하지 않는다.
    expect(navBadgesOf(2, null)).toEqual({ diff: { n: 2 } });
  });
});
