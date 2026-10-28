import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { Sidebar } from "@/components/Sidebar";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_ENTRIES } from "@/lib/navRegistry";
import { t } from "@/i18n";

// ─── best-results UI 라운드 — 사이드바 세 단 = 세 등급 ──────────────────────
//
// 간단 밀도: 핵심 4 는 항상, 도구(뷰어)는 접힌 채 시작한다. 접힘은 숨김이 아니다 —
// 토글로 펼쳐지고, 그 단의 화면이 열려 있으면 저절로 펼쳐진다. 보류 단은 2026-10-28 에
// 화면과 함께 걷었다 (simplify-round).

let density: "simple" | "pro" = "simple";
vi.mock("@/hooks/useDensity", () => ({
  useDensity: () => ({ density, set: () => {}, toggle: () => {} }),
  DensityShortcut: () => null,
}));

function renderSidebar(view: UiV2View = "today") {
  const calls: UiV2View[] = [];
  const utils = render(
    <Sidebar
      view={view}
      onNavigate={(v) => calls.push(v)}
      projectName="aurora-web"
      projectPath="~/dev/aurora-web"
      onOpenProjectSwitcher={() => {}}
      isDark={false}
      onToggleTheme={() => {}}
    />,
  );
  return { ...utils, calls };
}

afterEach(() => {
  cleanup();
  density = "simple";
});

const core = NAV_ENTRIES.filter((e) => e.tier === "core");
const viewer = NAV_ENTRIES.filter((e) => e.tier === "viewer");
const hold = NAV_ENTRIES.filter((e) => e.tier === "hold");

describe("Sidebar — three tiers and density", () => {
  it("tiers split into core 4 · viewer 4 · hold 0 (the PROMISE.md table)", () => {
    expect(core.map((e) => e.id)).toEqual(["today", "journal", "diff", "planner"]);
    expect(viewer.map((e) => e.id).sort()).toEqual(["branch", "discussion", "search", "skills"]);
    expect(hold).toEqual([]);
  });

  it("simple density: core only, tools folded behind a toggle", () => {
    const { queryByText, getByText } = renderSidebar();
    for (const e of core) expect(getByText(t(e.labelKey))).toBeTruthy();
    expect(queryByText(t("nav.search"))).toBeNull();
    // 접힌 단은 행 수를 말한다.
    const toggles = document.querySelectorAll(".nav-section-toggle");
    expect(toggles).toHaveLength(1);
    expect(toggles[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("a toggle unfolds its tier and its rows navigate", () => {
    const { getByText, calls } = renderSidebar();
    fireEvent.click(getByText(t("sidebar.viewerSection")));
    fireEvent.click(getByText(t("nav.search")));
    expect(calls).toEqual(["search"]);
    expect(document.querySelectorAll(".nav-section-toggle")[0].getAttribute("aria-expanded")).toBe("true");
  });

  it("a folded tier unfolds by itself when its screen is the active one", () => {
    const { getByText } = renderSidebar("search");
    expect(getByText(t("nav.search"))).toBeTruthy();
    expect(document.querySelectorAll(".nav-section-toggle")[0].getAttribute("aria-expanded")).toBe("true");
  });

  it("pro density: both tiers open, no toggles", () => {
    density = "pro";
    const { getByText } = renderSidebar();
    for (const e of [...core, ...viewer, ...hold]) expect(getByText(t(e.labelKey))).toBeTruthy();
    expect(document.querySelectorAll(".nav-section-toggle")).toHaveLength(0);
  });
});
