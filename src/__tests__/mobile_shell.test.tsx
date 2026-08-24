// 모바일 셸 (#mb3-tabs / #mb3-screens) — 페어링 게이트·탭·플랜 토글.
//
// jsdom 에는 __TAURI_INTERNALS__ 가 없어 main.tsx 라면 모바일 분기지만,
// 여기서는 MobileApp 을 직접 마운트한다. bindings 는 모킹 — 전송 계층은
// mobile_transport.test.ts 가 따로 검증한다.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const planApplyEdit = vi.fn();
const listProjects = vi.fn();
const listEntries = vi.fn();
const planList = vi.fn();
const planGet = vi.fn();

vi.mock("@/lib/bindings", () => ({
  commands: {
    listProjects: (...a: unknown[]) => listProjects(...a),
    oculpmListJournalEntries: (...a: unknown[]) => listEntries(...a),
    planRecentUpdates: async () => ({ status: "ok", data: [] }),
    planList: (...a: unknown[]) => planList(...a),
    planGet: (...a: unknown[]) => planGet(...a),
    planApplyEdit: (...a: unknown[]) => planApplyEdit(...a),
    discussionList: async () => ({ status: "ok", data: [] }),
    // 부트 후 applyDesktopTheme 이 테마·액센트를 읽는다 (mobile/theme.ts).
    settingsGet: async () => ({ status: "ok", data: null }),
  },
}));

import MobileApp from "@/mobile/MobileApp";
import { t } from "@/i18n";

const PROJECT = { id: 7, name: "ai-pm", root_path: "/tmp/ai-pm" };

const okFetch = (url: string) => {
  if (url === "/api/ping") return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(okFetch));
  listProjects.mockResolvedValue({ status: "ok", data: [PROJECT] });
  listEntries.mockResolvedValue({ status: "ok", data: [] });
  planList.mockResolvedValue({
    status: "ok",
    data: [{ plan_id: "mb", title: "mobile-bridge", status: "active", owner_agent: "claude-code", progress: 0.5 }],
  });
  planGet.mockResolvedValue({
    status: "ok",
    data: {
      plan: { plan_id: "mb", title: "mobile-bridge", status: "active", owner_agent: "claude-code", progress: 0.5 },
      items: [
        { item_id: "a", phase: "Phase 1", title: "first item", status: "todo", order_idx: 0, parent_item: null, note: null, last_agent: null, last_update: null, journal_refs: [] },
      ],
      phases: [],
      decisions: [],
      warnings: [],
    },
  });
  planApplyEdit.mockResolvedValue({ status: "ok", data: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MobileApp boot", () => {
  test("no token shows the pairing screen", async () => {
    render(<MobileApp />);
    expect(await screen.findByPlaceholderText("000000")).toBeTruthy();
    // 프로젝트 커맨드는 아직 부르지 않는다.
    expect(listProjects).not.toHaveBeenCalled();
  });

  test("valid token boots into tabs with the single project auto-selected", async () => {
    window.localStorage.setItem("oculpm:mobile:token", "tok");
    render(<MobileApp />);
    expect(await screen.findByText("ai-pm")).toBeTruthy();
    // 하단탭 5개.
    expect(screen.getByText(t("mobile.tab.today"))).toBeTruthy();
    expect(screen.getByText(t("mobile.tab.journal"))).toBeTruthy();
    expect(screen.getByText(t("mobile.tab.planner"))).toBeTruthy();
    expect(screen.getByText(t("mobile.tab.discussion"))).toBeTruthy();
    expect(screen.getByText("AI")).toBeTruthy();
  });

  test("401 ping falls back to pairing", async () => {
    window.localStorage.setItem("oculpm:mobile:token", "stale");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) })));
    render(<MobileApp />);
    expect(await screen.findByPlaceholderText("000000")).toBeTruthy();
  });
});

describe("PlannerTab", () => {
  test("toggling an item sends set_status with the next status", async () => {
    window.localStorage.setItem("oculpm:mobile:token", "tok");
    render(<MobileApp />);
    await screen.findByText("ai-pm");

    fireEvent.click(screen.getByText(t("mobile.tab.planner")));
    fireEvent.click(await screen.findByText("mobile-bridge"));
    fireEvent.click(await screen.findByText("first item"));

    await waitFor(() => expect(planApplyEdit).toHaveBeenCalledTimes(1));
    expect(planApplyEdit).toHaveBeenCalledWith(
      7,
      "mb",
      { kind: "set_status", item_id: "a", status: "in_progress" },
      "mobile",
    );
  });
});
