// 플러그인 연결 판정 · 오늘 (11-23 love-round #l3-plugin-connect).
//
// 「연결됨」 은 이 프로젝트에 켜진 설치가 있을 때만이다 — 마켓플레이스만 더했거나, 다른 프로젝트에만 깔았거나,
// 꺼 두었으면 첫 걸음은 끝나지 않고 그 상태에 맞는 명령 한 줄이 그 자리에 선다. 오늘 화면은 창으로 돌아오면
// 플러그인을 다시 읽는다(설치하고 와도 그대로이던 화면). 플러그인이 앱보다 새 판이면 올릴 것은 앱이다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { __resetTodayStoreForTests, useTodayExceptions } from "@/features/today/useTodayExceptions";
import { buildExceptions } from "@/features/today/todayModel";
import { t } from "@/i18n";
import {
  CLAUDE_PLUGIN_ENABLE,
  CLAUDE_PLUGIN_INSTALL,
  CLAUDE_PLUGIN_INSTALL_HERE,
  CLAUDE_PLUGIN_UPDATE,
} from "@/lib/agentCommands";
import type { ClaudePluginStatus } from "@/lib/bindings";
import { __setPlatformForTests } from "@/lib/platform";
import { pluginConnection, versionBelow } from "@/lib/pluginConnection";
import { WORKDAY, fx, resetFx } from "./todayFixture";
import { renderToday } from "./todayRender";

function status(over: Partial<ClaudePluginStatus> = {}): ClaudePluginStatus {
  return {
    state: "connected",
    installed: true,
    path: "/p",
    installed_version: "4.12.1",
    scope: "project",
    bundled_version: "4.12.1",
    behind: false,
    ahead: false,
    other_behind: 0,
    app_reachable: true,
    ...over,
  };
}

/** 셸의 배지 — 같은 저장소를 붙잡고 있어, 오늘 화면이 내려가도 저장소는 살아 있다(처음 붙은 쪽이 주인). */
function Badge() {
  useTodayExceptions(1, WORKDAY, true);
  return null;
}

const firstStep = (container: HTMLElement) => container.querySelector<HTMLElement>('.tdy-step[data-step="connect"]')!;

beforeEach(() => resetFx());
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
  __setPlatformForTests(null);
});

describe("pluginConnection — one verdict for Today, Settings and the empty planner", () => {
  it("only an enabled install for this project is connected; every other state carries its own command", () => {
    expect(pluginConnection(status(), "mac")).toEqual({ kind: "connected" });
    expect(pluginConnection(status({ state: "not_installed", installed: false }), "mac")).toEqual({ kind: "notInstalled", lines: CLAUDE_PLUGIN_INSTALL });
    expect(pluginConnection(status({ state: "marketplace_only", installed: false }), "mac")).toEqual({ kind: "marketplaceOnly", lines: CLAUDE_PLUGIN_INSTALL_HERE });
    expect(pluginConnection(status({ state: "other_project", installed: false }), "mac")).toEqual({ kind: "otherProject", lines: CLAUDE_PLUGIN_INSTALL_HERE });
    expect(pluginConnection(status({ state: "disabled" }), "mac")).toEqual({ kind: "disabled", lines: CLAUDE_PLUGIN_ENABLE });
    expect(pluginConnection(null, "mac")).toBeNull();
  });

  it("an app the plugin can't reach is not connected", () => {
    expect(pluginConnection(status({ app_reachable: false }), "mac")).toEqual({ kind: "unreachable" });
  });

  it("on Windows a plugin before 4.12 has no record tools, so it is not connected (4.12 #win-mcp)", () => {
    expect(pluginConnection(status({ installed_version: "4.11.0" }), "windows")).toEqual({ kind: "windowsOld", lines: CLAUDE_PLUGIN_UPDATE });
    expect(pluginConnection(status({ installed_version: "4.12.0" }), "windows")).toEqual({ kind: "connected" });
    expect(pluginConnection(status({ installed_version: "4.11.0" }), "mac")).toEqual({ kind: "connected" });
  });

  it("versionBelow is numeric and never nags on junk", () => {
    expect(versionBelow("4.9.3", "4.12.0")).toBe(true);
    expect(versionBelow("4.12.0", "4.12.0")).toBe(false);
    expect(versionBelow("0120fb83", "4.12.0")).toBe(false);
  });

  it("the plugin row says which side to update", () => {
    const base = { entries: [], digest: { plans: [], needs_user: [], blocked: [], journal_plan: [] }, unrecorded: [], silent: [] };
    expect(buildExceptions({ ...base, plugin: { installed: "4.12.0", bundled: "4.11.0", ahead: true } })).toEqual([
      { kind: "plugin", key: "plugin", installed: "4.12.0", bundled: "4.11.0", ahead: true },
    ]);
    expect(buildExceptions({ ...base, plugin: { installed: "4.3.0", bundled: "4.12.1" } })[0]).toMatchObject({ ahead: false });
  });
});

describe("first steps — connected means connected here", () => {
  it("a marketplace-only plugin leaves step 1 open with the one install line in place", async () => {
    fx.total = 0;
    fx.plugin = status({ state: "marketplace_only", installed: false, installed_version: null, scope: null });
    const { container, onNavigate } = renderToday();
    await screen.findByText(t("today.first.connectMarketplaceOnly"));
    const step = firstStep(container);
    expect(step.hasAttribute("data-done")).toBe(false);
    expect(within(step).getByText(CLAUDE_PLUGIN_INSTALL_HERE[0])).toBeInTheDocument();
    expect(within(step).getByRole("button", { name: t("common.copy") })).toBeInTheDocument();
    // 채운 단추는 둘째 걸음 몫이다 — 첫 걸음은 보통 단추와 링크만.
    expect(step.querySelector(".btn.primary")).toBeNull();
    fireEvent.click(within(step).getByRole("button", { name: t("today.first.openTerminal") }));
    expect(onNavigate).toHaveBeenCalledWith("terminal");
  });

  it.each([
    ["other_project", "today.first.connectOtherProject", CLAUDE_PLUGIN_INSTALL_HERE[0]],
    ["disabled", "today.first.connectDisabled", CLAUDE_PLUGIN_ENABLE[0]],
    ["not_installed", "today.first.connectNotInstalled", CLAUDE_PLUGIN_INSTALL[1]],
  ] as const)("%s → its own sentence and command", async (state, key, line) => {
    fx.total = 0;
    fx.plugin = status({ state, installed: state === "disabled" });
    const { container } = renderToday();
    await screen.findByText(t(key));
    expect(firstStep(container).hasAttribute("data-done")).toBe(false);
    expect(within(firstStep(container)).getByText(line)).toBeInTheDocument();
  });

  it("an app outside the Applications folder leaves step 1 open and says where to move it", async () => {
    __setPlatformForTests("mac");
    fx.total = 0;
    fx.plugin = status({ app_reachable: false });
    const { container } = renderToday();
    await screen.findByText(t("prefs.agents.unreachableMac"));
    expect(firstStep(container).hasAttribute("data-done")).toBe(false);
    expect(within(firstStep(container)).queryByRole("button", { name: t("today.first.openTerminal") })).toBeNull();
  });

  it("on Windows a 4.11 plugin is not a finished first step", async () => {
    __setPlatformForTests("windows");
    fx.total = 0;
    fx.plugin = status({ installed_version: "4.11.0", behind: true });
    const { container } = renderToday();
    await screen.findByText(t("today.first.connectWindowsOld"));
    expect(firstStep(container).hasAttribute("data-done")).toBe(false);
  });

  it("re-reads the plugin when the window comes back, so step 1 finishes after the install", async () => {
    fx.total = 0;
    fx.plugin = status({ state: "not_installed", installed: false });
    const { container } = renderToday();
    await screen.findByText(t("today.first.connectNotInstalled"));
    const before = fx.calls.claudePluginStatus ?? 0;
    fx.plugin = status();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(firstStep(container).hasAttribute("data-done")).toBe(true));
    expect(fx.calls.claudePluginStatus).toBeGreaterThan(before);
  });

  it("a failed re-read keeps the answer it had instead of falling back to unknown", async () => {
    fx.total = 0;
    fx.plugin = status({ state: "disabled" });
    const { container } = renderToday();
    await screen.findByText(t("today.first.connectDisabled"));
    const before = fx.calls.claudePluginStatus ?? 0;
    fx.plugin = null;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(fx.calls.claudePluginStatus).toBeGreaterThan(before));
    await act(async () => {});
    expect(within(firstStep(container)).getByText(t("today.first.connectDisabled"))).toBeInTheDocument();
  });

  it("re-reads the plugin when the Today screen mounts again (back from the terminal tab)", async () => {
    fx.total = 0;
    fx.plugin = status({ state: "not_installed", installed: false });
    render(<Badge />);
    const first = renderToday();
    await screen.findByText(t("today.first.connectNotInstalled"));
    // 배지가 붙잡고 있어 저장소는 살아 있다 — 화면만 다시 그린다(창 포커스는 그대로).
    first.unmount();
    fx.plugin = status();
    const { container } = renderToday();
    await waitFor(() => expect(firstStep(container).hasAttribute("data-done")).toBe(true));
  });
});

describe("the drift row", () => {
  it("an old plugin copies the same shell command as Settings and says to restart Claude", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    fx.plugin = status({ installed_version: "4.3.0", behind: true });
    renderToday();
    const copy = await screen.findByRole("button", { name: t("today.pluginDrift.copy") });
    expect(screen.getAllByText(CLAUDE_PLUGIN_UPDATE[0]).length).toBeGreaterThan(0);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CLAUDE_PLUGIN_UPDATE.join("\n")));
  });

  it("a plugin newer than the app sends you to the app update, not a plugin command", async () => {
    fx.plugin = status({ installed_version: "4.13.0", ahead: true });
    const { onNavigate } = renderToday();
    await screen.findByTitle(t("today.pluginDrift.aheadTitle", { installed: "4.13.0", bundled: "4.12.1" }));
    expect(screen.queryByRole("button", { name: t("today.pluginDrift.copy") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("today.pluginDrift.checkUpdate") }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });
});
