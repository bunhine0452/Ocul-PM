import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

// ─── v2.3.0 메뉴바 팝오버 (PR-MB2·3) ─────────────────────────────────────────
//
// 핵심 계약 — 팝오버는 기존 커맨드 집계만으로 그려지고(신규 백엔드 없음),
// 행 클릭은 전부 trayOpenMain 딥링크로 위임된다 (읽기 전용 원칙 D5).

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

function project() {
  return { id: 1, name: "ai-pm", root_path: "/x/ai-pm", created_at: 0 };
}

function entry(over: Record<string, unknown> = {}) {
  return {
    relative_path: "journal/20260720/Features_to_add/1000_feature_a.md",
    workday: "20260720",
    type: "feature",
    slug: "a",
    status: "done",
    difficulty: null,
    title: "트레이 팝오버 골격",
    checkbox: true,
    session_id: "20260720-001",
    agent_id: "claude-code",
    agent_version: null,
    verified_by_user: false,
    created_at: iso(30 * 60_000),
    updated_at: null,
    tags: [],
    files_count: 3,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

const fx = {
  sessions: [] as Record<string, unknown>[],
  entries: [] as Record<string, unknown>[],
  plans: [] as Record<string, unknown>[],
  calls: { openMain: [] as unknown[][], hide: [] as unknown[][] },
};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "listProjects":
              return () => ok([project()]);
            case "oculpmGetStatus":
              return () => ok({ current_workday: "20260720", initialized: true });
            case "oculpmListSessions":
              return () => ok(fx.sessions);
            case "oculpmListJournalEntries":
              return () => ok(fx.entries);
            case "planList":
              return () => ok(fx.plans);
            case "trayOpenMain":
              return (...a: unknown[]) => {
                fx.calls.openMain.push(a);
                return ok(null);
              };
            case "trayHidePopover":
              return (...a: unknown[]) => {
                fx.calls.hide.push(a);
                return ok(null);
              };
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { TrayPopover } from "@/features/tray/TrayPopover";

beforeEach(() => {
  fx.sessions = [
    {
      id: "20260720-007",
      started_at: iso(12 * 60_000),
      ended_at: null,
      ended_reason: null,
      active_window_ms: 0,
      file_event_count: 0,
      files_unique: 0,
      git_head_at_start: null,
      git_head_at_end: null,
      agent_label_guess: "claude-code",
      linked_journal_entries: [],
    },
  ];
  fx.entries = [entry(), entry({ relative_path: "journal/20260720/Bugs/0900_bug_b.md", type: "bug", title: "버그 수정", created_at: iso(90 * 60_000), files_count: 1 })];
  fx.plans = [
    {
      plan_id: "menubar-tray",
      title: "메뉴바 상주 라운드",
      status: "active",
      owner_agent: "claude-code",
      progress: 0.5,
      file_path: "x.md",
      updated_at: "",
      item_count: 6,
      done_count: 3,
    },
  ];
  fx.calls.openMain = [];
  fx.calls.hide = [];
});

afterEach(() => {
  cleanup();
});

describe("TrayPopover (v2.3.0 메뉴바)", () => {
  it("활성 세션·오늘 요약·플랜 진행률을 기존 커맨드 집계만으로 그린다", async () => {
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByText(/세션 1 활성/)).toBeTruthy());
    expect(r.getByText("claude-code")).toBeTruthy();
    expect(r.getByText(/12분째/)).toBeTruthy();
    // 오늘 한 줄 — 일지 2 · 변경 파일 4(3+1)
    expect(r.getByText("오늘 일지").parentElement?.textContent).toContain("2");
    expect(r.getByText("변경 파일").parentElement?.textContent).toContain("4");
    // 플랜 진행률
    expect(r.getByText("메뉴바 상주 라운드")).toBeTruthy();
    expect(r.getByText("3/6")).toBeTruthy();
  });

  it("일지 행 클릭 → trayOpenMain 딥링크 (journal + entry_path)", async () => {
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByText("트레이 팝오버 골격")).toBeTruthy());
    fireEvent.click(r.getByText("트레이 팝오버 골격"));
    await waitFor(() => expect(fx.calls.openMain).toHaveLength(1));
    expect(fx.calls.openMain[0][0]).toEqual({
      view: "journal",
      project_id: 1,
      entry_path: "journal/20260720/Features_to_add/1000_feature_a.md",
    });
  });

  it("빈 상태 — 세션 0·일지 0 이면 침묵도 정보로 보여준다 (D5)", async () => {
    fx.sessions = [];
    fx.entries = [];
    fx.plans = [];
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByText("지금 활성 세션 없음")).toBeTruthy());
    expect(r.getByText(/오늘 아직 기록 없음/)).toBeTruthy();
  });

  it("Esc 키 → trayHidePopover (닫기는 백엔드 위임)", async () => {
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByTestId("tray-popover")).toBeTruthy());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(fx.calls.hide).toHaveLength(1));
  });
});
