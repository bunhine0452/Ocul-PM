import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AutomationTab } from "@/features/settings/automation/AutomationTab";
import {
  blankDefinition,
  cardState,
  fieldsFor,
  formatAt,
  localValidation,
  slugify,
  sortSummaries,
} from "@/features/settings/automation/automationModel";
import type { AutomationDef, AutomationSummary } from "@/lib/bindings";

// 자동화 탭 (Osaurus 라운드 Phase 1).
//
// 이 파일이 지키는 계약:
//  1. 목록 정렬은 **고장난 것이 먼저** 보인다 — 조용히 안 도는 자동화를
//     맨 아래 묻어 두면 "왜 안 돌지" 를 영영 못 찾는다.
//  2. 「지금 실행」이 스킵/드롭으로 끝났을 때 **성공이라고 말하지 않는다**.
//  3. Core Model 미설정이면 게이트 안내가 뜬다 (D2).
//  4. 삭제는 확인을 거친다 (`useConfirm` 규약).

const listData = vi.hoisted(() => ({ current: [] as AutomationSummary[] }));
const seedData = vi.hoisted(() => ({ current: [] as AutomationDef[] }));
// `coreModelTarget` 이 읽는 두 값만 있으면 된다 — 전체 Settings 를 흉내 내면
// 기본값 표가 두 벌이 된다.
const coreModelSetting = vi.hoisted(() => ({ current: { coreProvider: "", coreModel: "" } }));
const runNowResult = vi.hoisted(() => ({
  current: { status: "ran", reason: null as string | null, journal_path: null as string | null },
}));
const calls = vi.hoisted(() => ({ current: [] as string[] }));
const toasts = vi.hoisted(() => ({ current: [] as Array<[string, string]> }));

vi.mock("@/api/automation", () => ({
  automationApi: {
    list: () => Promise.resolve(listData.current),
    seeds: () => Promise.resolve(seedData.current),
    runs: () => Promise.resolve([]),
    save: (_p: number, def: AutomationDef) => {
      calls.current.push(`save:${def.id}`);
      return Promise.resolve(listData.current[0]);
    },
    remove: (_p: number, _k: string, id: string) => {
      calls.current.push(`remove:${id}`);
      return Promise.resolve(true);
    },
    setEnabled: (_p: number, _k: string, id: string, enabled: boolean) => {
      calls.current.push(`enabled:${id}:${enabled}`);
      return Promise.resolve(listData.current[0]);
    },
    createSeed: (_p: number, id: string) => {
      calls.current.push(`seed:${id}`);
      return Promise.resolve(listData.current[0]);
    },
    runNow: (_p: number, _k: string, id: string) => {
      calls.current.push(`run:${id}`);
      return Promise.resolve(runNowResult.current);
    },
    cancel: () => Promise.resolve(null),
  },
}));

vi.mock("@/api/oculpm", () => ({
  oculpmApi: {
    getConfig: () =>
      Promise.resolve({
        automation: { schedules: true, watchers: false, daily_run_budget: 20 },
      }),
    setConfig: () => Promise.resolve(null),
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    info: (m: string) => toasts.current.push(["info", m]),
    warning: (m: string) => toasts.current.push(["warning", m]),
    destructive: (m: string) => toasts.current.push(["destructive", m]),
  },
}));

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ state: { currentProjectId: 1 } }),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: coreModelSetting.current as never }),
}));

function summary(over: Partial<AutomationDef> & { id: string }, rest: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    def: { ...blankDefinition("2026-08-31"), title: over.id, ...over },
    warnings: [],
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    spec_error: null,
    ...rest,
  };
}

beforeEach(() => {
  listData.current = [];
  seedData.current = [];
  coreModelSetting.current = {
    coreProvider: "anthropic",
    coreModel: "claude-3.5-haiku-latest",
  };
  runNowResult.current = { status: "ran", reason: null, journal_path: null };
  calls.current = [];
  toasts.current = [];
});

afterEach(cleanup);

describe("automationModel", () => {
  it("고장난 자동화가 목록 맨 위로 온다", () => {
    const sorted = sortSummaries([
      summary({ id: "paused", enabled: false }),
      summary({ id: "active", enabled: true }, { next_run_at: "2026-09-01T00:00:00+00:00" }),
      summary({ id: "broken", enabled: true }, { spec_error: "automation_bad_time" }),
    ]);
    expect(sorted.map((s) => s.def.id)).toEqual(["broken", "active", "paused"]);
    expect(cardState(sorted[0])).toBe("broken");
    expect(cardState(sorted[1])).toBe("active");
    expect(cardState(sorted[2])).toBe("paused");
  });

  it("빈도마다 켜지는 입력칸이 다르다", () => {
    expect(fieldsFor("weekly")).toMatchObject({ at: true, weekday: true, cron: false });
    expect(fieldsFor("cron")).toMatchObject({ at: false, cron: true });
    expect(fieldsFor("minutes")).toMatchObject({ every: true, at: false });
    expect(fieldsFor("once")).toMatchObject({ at: true, atIsDateTime: true });
  });

  it("id 는 ASCII kebab 으로만 만들어진다 (경로 탈출 차단)", () => {
    expect(slugify("Weekly Dev Summary")).toBe("weekly-dev-summary");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("...")).toBe("");
  });

  it("이름·지시문이 비면 저장을 막는다", () => {
    const def = blankDefinition("2026-08-31");
    expect(localValidation(def)).toBe("automation.err.titleRequired");
    expect(localValidation({ ...def, title: "t" })).toBe("automation.err.instructionsRequired");
    expect(localValidation({ ...def, title: "t", instructions: "i", id: "x" })).toBeNull();
  });

  it("깨진 시각은 표시하지 않고 null 로 떨어진다", () => {
    expect(formatAt(null)).toBeNull();
    expect(formatAt("nonsense")).toBeNull();
    expect(formatAt("2026-08-31T08:00:00+00:00")).not.toBeNull();
  });
});

describe("AutomationTab", () => {
  it("Core Model 이 없으면 게이트 안내가 뜬다", async () => {
    coreModelSetting.current = { coreProvider: "", coreModel: "" };
    render(<AutomationTab />);
    expect(
      await screen.findByText(/조용히 건너뜁니다|skipped silently/),
    ).toBeInTheDocument();
  });

  it("Core Model 이 있으면 게이트가 사라진다", async () => {
    render(<AutomationTab />);
    await waitFor(() => expect(screen.getByText("자동화")).toBeInTheDocument());
    expect(screen.queryByText(/조용히 건너뜁니다/)).toBeNull();
  });

  /// 「지금 실행」이 스킵으로 끝나면 성공이라고 말하지 않는다.
  it("스킵된 실행을 성공으로 보고하지 않는다", async () => {
    listData.current = [summary({ id: "weekly", title: "주간 요약", enabled: true })];
    runNowResult.current = {
      status: "skipped",
      reason: "core model not configured",
      journal_path: null,
    };
    render(<AutomationTab />);

    fireEvent.click(await screen.findByRole("button", { name: "자동화 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: /지금 실행/ }));

    await waitFor(() => expect(calls.current).toContain("run:weekly"));
    const [kind, message] = toasts.current[toasts.current.length - 1] ?? [];
    expect(kind).toBe("warning");
    expect(message).toContain("건너뛰었습니다");
    expect(message).toContain("core model not configured");
  });

  it("씨앗을 누르면 정의가 생긴다", async () => {
    seedData.current = [
      { ...blankDefinition("2026-08-31"), id: "morning-brief", title: "아침 브리핑" },
    ];
    render(<AutomationTab />);
    fireEvent.click(await screen.findByRole("button", { name: /아침 브리핑/ }));
    await waitFor(() => expect(calls.current).toContain("seed:morning-brief"));
  });

  it("삭제는 확인을 거친다", async () => {
    listData.current = [summary({ id: "weekly", title: "주간 요약", enabled: true })];
    render(<AutomationTab />);

    fireEvent.click(await screen.findByRole("button", { name: "자동화 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: /삭제/ }));

    // 확인 대화가 뜨기 전까지는 아무것도 지우지 않는다.
    expect(calls.current).not.toContain("remove:weekly");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(calls.current).toContain("remove:weekly"));
  });
});
