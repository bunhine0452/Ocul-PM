import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

// ─── v2.3.0 메뉴바 팝오버 (PR-MB2·3) ─────────────────────────────────────────
//
// 핵심 계약 — 팝오버는 기존 커맨드 집계만으로 그려지고(신규 백엔드 없음),
// 행 클릭은 전부 trayOpenMain 딥링크로 위임된다 (읽기 전용 원칙 D5).

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

function project() {
  return { id: 1, name: "ai-pm", root_path: "/x/ai-pm", created_at: 0, icon: null, color: null };
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
  settings: [] as [string, string][],
  calls: {
    openMain: [] as unknown[][],
    hide: [] as unknown[][],
    settingsSet: [] as unknown[][],
    getEntry: [] as unknown[][],
    getPlan: [] as unknown[][],
    applySettings: 0,
  },
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
            case "planGet":
              return (...a: unknown[]) => {
                fx.calls.getPlan.push(a);
                return ok({
                  plan: fx.plans[0],
                  items: [
                    { item_id: "a", phase: null, title: "끝난 항목", status: "done", order_idx: 0, parent_item: null, note: null, last_agent: null, last_update: null },
                    { item_id: "b", phase: null, title: "실기기 확인", status: "todo", order_idx: 1, parent_item: null, note: null, last_agent: null, last_update: null },
                  ],
                  phases: [],
                  decisions: [],
                  warnings: [],
                });
              };
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
            case "oculpmGetJournalEntry":
              return (...a: unknown[]) => {
                fx.calls.getEntry.push(a);
                return ok({
                  relative_path: a[1],
                  title: "트레이 팝오버 골격",
                  checkbox: true,
                  body_markdown:
                    "[x] 트레이 팝오버 골격\n\n## 추가 기능\n\n- 팝오버 안 **일지 읽기**\n\n```rust\nfn x() {}\n```",
                  frontmatter: {
                    type: "feature",
                    created_at: iso(30 * 60_000),
                    agent: { id: "claude-code", version: "Fable 5" },
                  },
                });
              };
            case "settingsGetAll":
              return () => ok(fx.settings);
            case "settingsSet":
              return (...a: unknown[]) => {
                fx.calls.settingsSet.push(a);
                return ok(null);
              };
            case "trayApplySettings":
              return () => {
                fx.calls.applySettings += 1;
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
  fx.entries = [
    entry(),
    entry({ relative_path: "journal/20260720/Bugs/0900_bug_b.md", type: "bug", title: "버그 수정", created_at: iso(90 * 60_000), files_count: 1 }),
    // 어제 일지 — "오늘" 수치에서 제외돼야 한다 (workday=null 조회는 전체 반환).
    entry({ relative_path: "journal/20260719/Chores/2200_chore_c.md", workday: "20260719", type: "chore", title: "어제 잡일", created_at: iso(20 * 3_600_000), files_count: 99 }),
  ];
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
  fx.settings = [];
  fx.calls.openMain = [];
  fx.calls.hide = [];
  fx.calls.settingsSet = [];
  fx.calls.getEntry = [];
  fx.calls.getPlan = [];
  fx.calls.applySettings = 0;
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
    // 오늘 한 줄 — 어제 일지(files 99)는 제외: 일지 2 · 변경 파일 4(3+1)
    expect(r.getByText("오늘 일지").parentElement?.textContent).toContain("2");
    expect(r.getByText("변경 파일").parentElement?.textContent).toContain("4");
    // 최근 목록에는 어제 것도 날짜 표기로 나온다
    expect(r.getByText("어제 잡일")).toBeTruthy();
    expect(r.getByText("7/19")).toBeTruthy();
    // 플랜 진행률 + "다음 할 일" 1줄 (planGet 항목에서 계산)
    expect(r.getByText("메뉴바 상주 라운드")).toBeTruthy();
    expect(r.getByText("3/6")).toBeTruthy();
    await waitFor(() => expect(r.getByText("다음: 실기기 확인")).toBeTruthy());
  });

  it("플랜 행 클릭 → 팝오버 안 상세(항목 글리프 목록) → '앱에서 열기' 딥링크", async () => {
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByText("메뉴바 상주 라운드")).toBeTruthy());
    fireEvent.click(r.getByText("메뉴바 상주 라운드"));

    await waitFor(() => expect(r.getByText("끝난 항목")).toBeTruthy());
    expect(r.getByText("실기기 확인")).toBeTruthy();
    expect(fx.calls.openMain).toHaveLength(0);

    fireEvent.click(r.getByText(/앱에서 열기/));
    await waitFor(() => expect(fx.calls.openMain).toHaveLength(1));
    expect(fx.calls.openMain[0][0]).toMatchObject({ view: "planner", project_id: 1 });

    fireEvent.click(r.getByRole("button", { name: "뒤로" }));
    await waitFor(() => expect(r.getByText(/세션 1 활성/)).toBeTruthy());
  });

  it("일지 행 클릭 → 팝오버 안 상세(본문 마크다운 라이트) → '앱에서 열기' 딥링크", async () => {
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByText("트레이 팝오버 골격")).toBeTruthy());
    fireEvent.click(r.getByText("트레이 팝오버 골격"));

    // 상세 패널 — 본문이 팝오버 안에서 읽힌다 (딥링크 아님). 메타에 모델명.
    await waitFor(() => expect(r.getByText("추가 기능")).toBeTruthy());
    expect(r.getByText(/claude-code · Fable 5 ·/)).toBeTruthy();
    expect(fx.calls.getEntry[0]).toEqual([1, "journal/20260720/Features_to_add/1000_feature_a.md"]);
    expect(fx.calls.openMain).toHaveLength(0);
    expect(r.getByText("일지 읽기")).toBeTruthy(); // **굵게** 인라인
    expect(r.getByText("fn x() {}")).toBeTruthy(); // 코드펜스
    // 본문 첫 줄의 [x] 체크박스 제목은 헤더와 중복 — 렌더에서 제거된다.
    expect(r.getAllByText(/트레이 팝오버 골격/)).toHaveLength(1);

    // 앱에서 열기 = 기존 딥링크 경로.
    fireEvent.click(r.getByText(/앱에서 열기/));
    await waitFor(() => expect(fx.calls.openMain).toHaveLength(1));
    expect(fx.calls.openMain[0][0]).toEqual({
      view: "journal",
      project_id: 1,
      entry_path: "journal/20260720/Features_to_add/1000_feature_a.md",
    });

    // 뒤로 → 메인 화면 복귀.
    fireEvent.click(r.getByRole("button", { name: "뒤로" }));
    await waitFor(() => expect(r.getByText(/세션 1 활성/)).toBeTruthy());
  });

  it("빈 상태 — 세션 0·일지 0 이면 침묵도 정보로 보여준다 (D5)", async () => {
    fx.sessions = [];
    fx.entries = [];
    fx.plans = [];
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByText("지금 활성 세션 없음")).toBeTruthy());
    expect(r.getByText(/오늘 아직 기록 없음/)).toBeTruthy();
  });

  it("일지 목록 — 4행 상한 없이 최근 것을 쌓고 스크롤 영역이 소유한다", async () => {
    // 상한이 4였을 때는 5번째부터 아예 렌더되지 않았다 (실기기 피드백:
    // "6개는 보이고 위아래로 넘길 수 있으면 좋겠다").
    fx.entries = Array.from({ length: 12 }, (_, i) =>
      entry({
        relative_path: `journal/20260720/Chores/10${String(i).padStart(2, "0")}_chore_${i}.md`,
        title: `일지 ${i}`,
        created_at: iso(i * 60_000),
      }),
    );
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByText("일지 0")).toBeTruthy());
    expect(r.getByText("일지 5")).toBeTruthy(); // 6번째 행
    expect(r.getByText("일지 11")).toBeTruthy(); // 스크롤로 닿는 행
    // 스크롤 소유자는 목록 섹션 하나뿐 — 카드/문서는 스크롤하지 않는다.
    expect(r.getByText("일지 0").closest(".tp-entries")).toBeTruthy();
  });

  it("Esc 키 → trayHidePopover (닫기는 백엔드 위임)", async () => {
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByTestId("tray-popover")).toBeTruthy());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(fx.calls.hide).toHaveLength(1));
  });

  it("프로젝트 스위처 — 드롭다운에서 선택하면 해당 프로젝트만 집계", async () => {
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByText(/세션 1 활성/)).toBeTruthy());
    fireEvent.click(r.getByRole("button", { name: "프로젝트" }));
    await waitFor(() => expect(r.getByRole("listbox")).toBeTruthy());
    // 전체 + ai-pm 두 옵션, 오늘 카운트 배지
    const options = r.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("전체 프로젝트"),
      expect.stringContaining("ai-pm"),
    ]);
    fireEvent.click(options[1]);
    await waitFor(() => expect(r.queryByRole("listbox")).toBeNull());
  });

  it("설정 → 팝오버 안 토글 패널: 저장 즉시 trayApplySettings, 전체 설정은 앱 딥링크", async () => {
    fx.settings = [["tray.keep_running", "0"]];
    const r = render(<TrayPopover />);
    await waitFor(() => expect(r.getByText(/세션 1 활성/)).toBeTruthy());
    fireEvent.click(r.getByRole("button", { name: "설정" }));
    await waitFor(() => expect(r.getByText("상단바 설정")).toBeTruthy());

    fireEvent.click(r.getByText(/창 닫기\(⌘W\) = 메뉴바로 최소화/));
    await waitFor(() => expect(fx.calls.settingsSet).toHaveLength(1));
    expect(fx.calls.settingsSet[0]).toEqual(["tray.keep_running", "1"]);
    await waitFor(() => expect(fx.calls.applySettings).toBe(1));

    fireEvent.click(r.getByText(/앱에서 전체 설정 열기/));
    await waitFor(() => expect(fx.calls.openMain).toHaveLength(1));
    expect(fx.calls.openMain[0][0]).toMatchObject({ view: "settings" });
  });
});
