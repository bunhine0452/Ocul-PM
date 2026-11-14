// 윗줄 다듬기 (11-15) — 화면을 바꿔도 같은 단계, 조용한 찾기, 가장 심한 행의 배지 색, 터미널 점, 날짜,
// 그리고 창을 열 때마다 다시 뜨던 규칙 템플릿 경고(판마다 한 번).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";

const fx = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  upgradeChecks: 0,
}));

vi.mock("@/lib/bindings", () => {
  const ok = (data: unknown) => Promise.resolve({ status: "ok", data });
  const commands: Record<string, (...args: unknown[]) => unknown> = {
    oculpmInit: () => ok({ created_dirs: [], wrote_config: false, wrote_gitignore: false, agent_files: [] }),
    oculpmGetStatus: () => ok({ initialized: true, current_workday: "20261115" }),
    oculpmAgentsCheckMasterAhead: () => ok(null),
    oculpmAgentsCheckMasterUpgrade: () => {
      fx.upgradeChecks += 1;
      return ok({ from_version: 18, to_version: 19 });
    },
    settingsGetAll: () => ok([...fx.settings.entries()]),
    settingsSet: (key: unknown, value: unknown) => {
      fx.settings.set(String(key), String(value));
      return ok(null);
    },
  };
  return {
    commands: new Proxy(commands, { get: (target, prop: string) => target[prop] ?? (() => ok(null)) }),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: new Proxy({}, { get: (_t, prop) => (prop === "onFileChanged" ? () => Promise.resolve(() => {}) : async () => null) }),
}));
vi.mock("@/api/projects", () => ({
  projectsApi: { syncColor: async () => false, brief: async () => null, onJournalAdded: () => Promise.resolve(() => {}) },
}));
vi.mock("@/api/window", () => ({
  windowApi: { openProjectWindow: async () => null, openProjectIds: async () => [], attention: async () => new Map(), onAttentionChanged: async () => () => {} },
}));
vi.mock("@/features/oculpm/useOculpmLive", () => ({ useOculpmDataEvents: () => {} }));
// 셸은 날짜 함수만 진짜로 쓴다 — 창 본문(지연 청크)은 그리지 않는다.
vi.mock("@/features/shell/ShellV2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/shell/ShellV2")>()),
  default: () => null,
}));
vi.mock("@/features/today/TodayScreenV2", () => ({ TodayScreenV2: () => null }));
vi.mock("@/features/oculpm/JournalScreenV2", () => ({ JournalScreenV2: () => null }));
vi.mock("@/features/planner/PlannerScreenV2", () => ({ PlannerScreenV2: () => null }));
vi.mock("@/features/diff/DiffScreenV2", () => ({ DiffScreenV2: () => null }));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/features/deeplink/DeepLinkSheet", () => ({ DeepLinkSheet: () => null }));
vi.mock("@/features/terminal/SendToClaudeHost", () => ({ SendToClaudeHost: () => null }));
vi.mock("@/features/terminal/useTermCloseGuard", () => ({ useTermCloseGuard: () => null }));
vi.mock("@/features/terminal/attention", () => ({ setAlertProjectName: () => {}, useHookWaitingAlerts: () => {} }));

import { TopBar } from "@/features/shell/TopBar";
import { navBadgesOf, type NavBadges } from "@/features/shell/useNavBadges";
import { decideFit, decideFold } from "@/features/shell/useTopbarFit";
import { shellDateLabel } from "@/features/shell/ShellV2";
import ProjectWindow from "@/windows/ProjectWindow";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { t } from "@/i18n";
import { toast } from "@/lib/toast";
import type { Project } from "@/lib/bindings";

const PROJECTS: Project[] = [{ id: 1, name: "ai-pm", root_path: "/Users/me/ai-pm", created_at: 1, icon: null, color: null }];

/**
 * jsdom 은 배치를 안 한다 — 윗줄 조각의 폭을 CSS 대로 흉내 낸다(shell.css 의 data-fit · data-fold 규칙).
 * 탭은 단계 2 에서 아이콘(160), 찾기는 단계 1 부터 키를 감춘다(64 → 34), 화면 동작은 접히면 0.
 */
function widthOf(el: Element): number {
  const bar = el.closest(".topbar");
  const fit = Number(bar?.getAttribute("data-fit") ?? 0);
  const fold = bar?.hasAttribute("data-fold") ?? false;
  const has = (c: string) => el.classList.contains(c);
  if (has("topbar")) return 0;
  if (has("proj-switch-wrap")) return 120;
  if (has("topnav")) return fit >= 2 ? 160 : 420;
  if (has("find-btn")) return fit >= 1 ? 34 : 64;
  if (has("topbar-settings")) return 30;
  if (has("topbar-sep")) return 1;
  if (has("topbar-more")) return fold ? 30 : 0;
  if (has("topbar-actions")) return fold ? 0 : [...el.children].reduce((sum, c) => sum + Number((c as HTMLElement).dataset.w ?? 0), 0);
  return 0;
}

function stubLayout(barWidth: number) {
  const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return { width: widthOf(this), height: 30, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("topbar") ? barWidth : 0;
  });
  return () => {
    rect.mockRestore();
    client.mockRestore();
  };
}

function actions(widths: number[]): HTMLElement[] {
  return widths.map((w, i) => {
    const button = Object.assign(document.createElement("button"), { textContent: `action ${i}` });
    button.dataset.w = String(w);
    return button;
  });
}

function renderBar(badges: NavBadges = {}, slot?: (el: HTMLDivElement | null) => void) {
  return render(
    <TopBar
      view="today"
      onNavigate={() => {}}
      projectName="ai-pm"
      currentProjectId={1}
      projects={PROJECTS}
      onOpenProject={() => {}}
      badges={badges}
      slotRef={slot ?? (() => {})}
    />,
  );
}

beforeEach(() => {
  fx.settings = new Map();
  fx.upgradeChecks = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fit — the tabs do not move between screens", () => {
  it("two screens with different actions at one width share data-fit; only the actions fold", async () => {
    // 고정 부분(프로젝트 120 · 탭 420 · 선 1 · 찾기 64 · 설정 30 + ⋯ 자리 30) = 665, 일지 동작 90 → 725, 터미널 290 → 925.
    const restore = stubLayout(760);
    let box: HTMLDivElement | null = null;
    const { container } = renderBar({}, (el) => {
      if (el && !box) {
        box = el;
        el.append(...actions([90]));
      }
    });
    const bar = container.querySelector(".topbar")!;
    await act(async () => {});
    const journalFit = bar.getAttribute("data-fit");
    expect(bar.hasAttribute("data-fold")).toBe(false);
    // 터미널처럼 넓은 화면 동작으로 바꾼다 — 단계는 그대로, 화면 동작만 ⋯ 로.
    await act(async () => box!.replaceChildren(...actions([120, 30, 30, 110])));
    expect(bar.getAttribute("data-fit")).toBe(journalFit);
    expect(bar.hasAttribute("data-fold")).toBe(true);
    restore();
  });

  it("decides the stage from the fixed part alone, with slack before stepping down or unfolding", () => {
    expect(decideFit([640, 610, 350], 700, 0)).toBe(0);
    expect(decideFit([640, 610, 350], 620, 0)).toBe(1);
    expect(decideFit([640, 610, 350], 400, 0)).toBe(2);
    // 경계에서 오락가락하지 않는다 — 내리려면 여유(12px)가 있어야 한다.
    expect(decideFit([640, 610, 350], 645, 1)).toBe(1);
    expect(decideFit([640, 610, 350], 660, 1)).toBe(0);
    expect(decideFold(710, 700, false)).toBe(true);
    expect(decideFold(695, 700, true)).toBe(true);
    expect(decideFold(680, 700, true)).toBe(false);
  });
});

describe("top bar — find, badges, terminal dot", () => {
  it("find is a quiet button — no bordered small-button class", () => {
    renderBar();
    const find = screen.getByRole("button", { name: new RegExp(`^${t("toolbar.find")}`) });
    expect(find).toHaveClass("ghost");
    expect(find).not.toHaveClass("sm");
  });

  it("the Today badge takes the colour of its worst row and leaves neutral rows out of the count", () => {
    const badges = navBadgesOf(0, 3, { todayRows: [{ kind: "unrecorded" }, { kind: "verdict" }, { kind: "plugin" }] });
    expect(badges.today).toEqual({ n: 2, tone: "danger", title: t("nav.badgeTitleFail", { n: 2, m: 1 }) });
    renderBar(badges);
    const today = screen.getAllByRole("button").find((b) => b.querySelector(".topnav-label")?.textContent === t("nav.today"))!;
    const badge = today.querySelector(".nav-badge")!;
    expect(badge).toHaveAttribute("data-tone", "danger");
    expect(badge).toHaveTextContent("2");
    expect(navBadgesOf(0, 1, { todayRows: [{ kind: "stale" }] }).today?.tone).toBe("warn");
  });

  it("a waiting terminal session puts a dot on the Terminal tab — not a number", () => {
    renderBar(navBadgesOf(null, undefined, { termWaiting: true }));
    const terminal = screen.getAllByRole("button").find((b) => b.querySelector(".topnav-label")?.textContent === t("nav.terminal"))!;
    expect(terminal.querySelector(".nav-dot")).not.toBeNull();
    expect(terminal.querySelector(".nav-badge")).toBeNull();
    expect(within(terminal).getByText(t("nav.termWaiting"))).toHaveClass("sr-only");
  });
});

describe("shell date", () => {
  it("reads month, day and a short weekday in parentheses — no year", () => {
    const sunday = new Date(2026, 10, 15);
    expect(shellDateLabel("ko", sunday)).toMatch(/^11월 15일 \(일\)$/u); // i18n-ignore -- 날짜 표기 자체가 검사 재료다
    expect(shellDateLabel("en", sunday)).toBe("Sun, November 15");
    expect(shellDateLabel("ko", sunday)).not.toMatch(/2026/);
  });
});

describe("template warning — once per version", () => {
  it("mounting the project window twice with the same template gap warns once", async () => {
    const warn = vi.spyOn(toast, "warning");
    const mount = () =>
      render(
        <WorkspaceProvider projectId={1}>
          <ProjectWindow projectId={1} projects={PROJECTS} />
        </WorkspaceProvider>,
      );
    const first = mount();
    await waitFor(() => expect(fx.settings.size).toBe(1));
    first.unmount();
    mount();
    await waitFor(() => expect(fx.upgradeChecks).toBe(2));
    await act(async () => {});
    const upgrades = warn.mock.calls.filter(([message]) => message === t("agents.upgrade.title"));
    expect(upgrades).toHaveLength(1);
  });
});
