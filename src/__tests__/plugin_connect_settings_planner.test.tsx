// 플러그인 연결 판정 · 설정의 플러그인 행 · 계획 빈 화면 (11-23 love-round #l3-plugin-connect).
//
// 설정은 「설치 안 됨 · 마켓플레이스만 · 다른 프로젝트에만 · 꺼짐 · 앱을 못 찾음」 을 가르고, 상태마다 붙여 넣을
// 명령이 다르다. 다른 프로젝트의 옛 판 수는 흐린 한 줄이다. 계획 빈 화면은 플러그인이 없으면 `/oculpm:inception`
// 대신 설치 명령과 쉬운 말 프롬프트를 준다 — Claude 가 모르는 슬래시 명령으로는 계획이 생기지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const pluginFx = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/lib/bindings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/bindings")>();
  const planner = (await import("./plannerHarness")).plannerBindings();
  return { ...orig, commands: planner.commands, events: planner.events };
});
vi.mock("@/api/claudeSurface", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/api/claudeSurface")>();
  return { ...orig, claudeInstallApi: { ...orig.claudeInstallApi, pluginStatus: async () => pluginFx.value } };
});
vi.mock("@/features/terminal/runPrompt", async () => (await import("./plannerHarness")).runPromptModule());

import { INCEPTION_PROMPT, PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { ClaudePluginRow } from "@/features/settings/ClaudePluginRow";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { t } from "@/i18n";
import { CLAUDE_PLUGIN_ENABLE, CLAUDE_PLUGIN_INSTALL, CLAUDE_PLUGIN_INSTALL_HERE } from "@/lib/agentCommands";
import type { ClaudePluginStatus } from "@/lib/bindings";
import { __setPlatformForTests } from "@/lib/platform";
import { pfx, resetPlanFixtures, stage } from "./plannerHarness";

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

function wrap(node: React.ReactNode) {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>{node}</WorkspaceProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  resetPlanFixtures();
  pluginFx.value = null;
});
afterEach(() => {
  cleanup();
  __setPlatformForTests(null);
});

describe("settings · Claude plugin row", () => {
  it.each([
    ["marketplace_only", "prefs.agents.marketplaceOnly", CLAUDE_PLUGIN_INSTALL_HERE[0]],
    ["other_project", "prefs.agents.otherProject", CLAUDE_PLUGIN_INSTALL_HERE[0]],
    ["disabled", "prefs.agents.disabled", CLAUDE_PLUGIN_ENABLE[0]],
    ["not_installed", "prefs.agents.notInstalled", CLAUDE_PLUGIN_INSTALL[0]],
  ] as const)("%s is not 「connected」 and shows its own command", async (state, chip, line) => {
    pluginFx.value = status({ state, installed: state === "disabled" });
    wrap(<ClaudePluginRow tick={0} />);
    expect(await screen.findByText(t(chip))).toBeInTheDocument();
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.queryByText(t("prefs.agents.connected"))).toBeNull();
    expect(screen.getByText(t("prefs.agents.restartHint"))).toBeInTheDocument();
  });

  it("an app the plugin can't reach says to move it to Applications on macOS", async () => {
    __setPlatformForTests("mac");
    pluginFx.value = status({ app_reachable: false });
    wrap(<ClaudePluginRow tick={0} />);
    expect(await screen.findByText(t("prefs.agents.unreachable"))).toBeInTheDocument();
    expect(screen.getByText(t("prefs.agents.unreachableMac"))).toBeInTheDocument();
  });

  it("a plugin newer than the app points at the app update", async () => {
    pluginFx.value = status({ installed_version: "4.13.0", ahead: true });
    wrap(<ClaudePluginRow tick={0} />);
    expect(await screen.findByText(t("prefs.agents.ahead"))).toBeInTheDocument();
    expect(screen.getByText("4.12.1 → 4.13.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("prefs.agents.seeUpdate") })).toBeInTheDocument();
  });

  it("connected here, with the other projects' old versions as one quiet line", async () => {
    pluginFx.value = status({ other_behind: 13 });
    wrap(<ClaudePluginRow tick={0} />);
    expect(await screen.findByText(t("prefs.agents.connected"))).toBeInTheDocument();
    expect(screen.getByText(t("prefs.agents.otherBehind", { n: 13 }))).toBeInTheDocument();
  });
});

describe("planner · empty screen without the plugin", () => {
  const renderPlanner = () => wrap(<PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />);

  it("without the plugin it shows the install command first and hands Claude plain words, not /oculpm:inception", async () => {
    pluginFx.value = status({ state: "not_installed", installed: false });
    stage([]);
    const { container } = renderPlanner();
    expect(await screen.findByText(t("plan.emptyNoPlugin"))).toBeInTheDocument();
    expect(screen.getByText(CLAUDE_PLUGIN_INSTALL[0])).toBeInTheDocument();
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: t("plan.emptyStart") }));
    await waitFor(() => expect(pfx.runs).toHaveLength(1));
    expect(pfx.runs[0].startsWith("/oculpm:")).toBe(false);
    expect(pfx.runs[0]).toBe(t("plan.emptyPromptNoPlugin"));
  });

  it("a turned-off plugin gets the turn-on command under the same name as Settings, not an install", async () => {
    pluginFx.value = status({ state: "disabled" });
    stage([]);
    renderPlanner();
    expect(await screen.findByText(t("plan.emptyNoPlugin"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("prefs.agents.enableCmd"))).toHaveTextContent(CLAUDE_PLUGIN_ENABLE[0]);
    expect(screen.queryByLabelText(t("prefs.agents.installCmd"))).toBeNull();
  });

  it("with the plugin connected here it keeps the inception skill", async () => {
    pluginFx.value = status();
    stage([]);
    renderPlanner();
    expect(await screen.findByText(t("plan.emptyAgents"))).toBeInTheDocument();
    // 상태가 온 뒤에 누른다 — 모를 때도 스킬이지만, 답이 연결됨인지까지 문다.
    await waitFor(() => expect(screen.queryByText(t("plan.emptyNoPlugin"))).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: t("plan.emptyStart") }));
    await waitFor(() => expect(pfx.runs).toEqual([INCEPTION_PROMPT]));
  });
});
