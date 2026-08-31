import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AutomationTab } from "@/features/settings/automation/AutomationTab";
import {
  blankDefinition,
  cardState,
  describeAutomation,
  fieldsFor,
  formatAt,
  localValidation,
  slugify,
  sortSummaries,
  switchKind,
} from "@/features/settings/automation/automationModel";
import { AutomationEditor } from "@/features/settings/automation/AutomationEditor";
import type { AutomationDef, AutomationSummary } from "@/lib/bindings";

// 자동화 탭 (Osaurus 라운드 Phase 1).
//
// 이 파일이 지키는 계약:
//  1. 목록 정렬은 **고장난 것이 먼저** 보인다 — 조용히 안 도는 자동화를
//     맨 아래 묻어 두면 "왜 안 돌지" 를 영영 못 찾는다.
//  2. 「지금 실행」이 스킵/드롭으로 끝났을 때 **성공이라고 말하지 않는다**.
//  3. Core Model 미설정이면 게이트 안내가 뜬다 (D2).
//  4. 삭제는 확인을 거친다 (`useConfirm` 규약).
//
// Phase 2 가 더한 것:
//  5. 워처 카드는 **빈도가 아니라 감시 범위와 티어**를 말한다 — 스케줄 문장을
//     그대로 쓰면 "빈도 미설정" 이라는 거짓 경고가 뜬다.
//  6. 종류를 바꾸면 반대편 축의 필드가 남지 않는다 (파일이 SSOT 라 디스크에
//     그대로 쓰인다).
//  7. 영원히 안 도는 감시 경로(`..`·절대경로)는 저장 전에 막는다.
//  8. 문제 해결 3종은 에디터와 목록이 **같은 말**을 쓴다 (설계 §2.5).

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

  it("워처 카드는 빈도가 아니라 감시 범위와 티어를 말한다", () => {
    const watcher = blankDefinition("2026-08-31", "watcher");
    const line = describeAutomation(watcher);
    expect(line).toContain("프로젝트 전체");
    expect(line).toContain("하위 폴더 포함");
    expect(line).toContain("보통");
    // 스케줄 문장으로 새지 않는다 (빈도가 없어 "빈도 미설정" 이 뜨던 자리).
    expect(line).not.toContain("빈도 미설정");

    const scoped = describeAutomation({
      ...watcher,
      watch: "src/",
      recursive: false,
      responsiveness: "deferred",
    });
    expect(scoped).toContain("src/");
    expect(scoped).toContain("바로 아래 파일만");
    expect(scoped).toContain("지연");

    // 스케줄은 그대로 반복 문장을 쓴다.
    expect(describeAutomation(blankDefinition("2026-08-31"))).toContain("매일");
  });

  it("종류를 바꾸면 반대편 축의 필드가 남지 않는다", () => {
    const schedule = {
      ...blankDefinition("2026-08-31"),
      id: "keep-me",
      title: "제목",
      instructions: "지시문",
      enabled: true,
      weekday: "fri",
    };
    const watcher = switchKind(schedule, "watcher");
    expect(watcher.kind).toBe("watcher");
    expect(watcher.frequency).toBeNull();
    expect(watcher.at).toBeNull();
    expect(watcher.weekday).toBeNull();
    expect(watcher.responsiveness).toBe("balanced");
    // 사람이 쓴 것은 남기고, 켜는 것은 다시 결정하게 한다.
    expect(watcher.id).toBe("keep-me");
    expect(watcher.instructions).toBe("지시문");
    expect(watcher.enabled).toBe(false);

    // 되돌리면 워처 필드가 사라진다.
    const back = switchKind(watcher, "schedule");
    expect(back.watch).toBeNull();
    expect(back.responsiveness).toBeNull();
    expect(back.frequency).toBe("daily");
    // 같은 종류로 바꾸는 것은 무해한 no-op.
    expect(switchKind(back, "schedule")).toBe(back);
  });

  it("영원히 안 도는 감시 경로는 저장 전에 막는다", () => {
    const base = {
      ...blankDefinition("2026-08-31", "watcher"),
      id: "w",
      title: "t",
      instructions: "i",
    };
    expect(localValidation(base)).toBeNull();
    expect(localValidation({ ...base, watch: "src/features" })).toBeNull();
    expect(localValidation({ ...base, watch: "/etc" })).toBe("automation.err.badWatch");
    expect(localValidation({ ...base, watch: "../other" })).toBe("automation.err.badWatch");
    // 스케줄에는 이 규칙이 없다 (watch 를 안 쓴다).
    expect(localValidation({ ...blankDefinition("2026-08-31"), id: "s", title: "t", instructions: "i", watch: "/etc" })).toBeNull();
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

  it("감시 전역 스위치와 문제 해결 3종이 같이 보인다", async () => {
    render(<AutomationTab />);
    // 두 축이 **따로** 꺼진다 — 시계와 감시는 도는 빈도가 다르다.
    expect(
      await screen.findByText("정해진 시각에 자동화를 실행합니다")
    ).toBeInTheDocument();
    expect(screen.getByText("파일 변경이 멎으면 자동화를 실행합니다")).toBeInTheDocument();
    // 문제 해결 3종.
    expect(screen.getByText("안 돌았다 —")).toBeInTheDocument();
    expect(screen.getByText("너무 자주 돈다 —")).toBeInTheDocument();
    expect(screen.getByText("결과가 이상하다 —")).toBeInTheDocument();
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

describe("AutomationEditor (워처)", () => {
  const noop = () => {};

  it("워처는 감시 필드를, 스케줄은 빈도 필드를 보여 준다", () => {
    render(
      <AutomationEditor
        value={blankDefinition("2026-08-31", "watcher")}
        isNew
        busy={false}
        onCancel={noop}
        onSave={noop}
      />
    );
    expect(screen.getByText("감시 경로")).toBeInTheDocument();
    expect(screen.getByText("반응성")).toBeInTheDocument();
    // 빈도 칸이 워처 화면에 남아 있으면 사용자가 채우고도 안 돈다.
    expect(screen.queryByText("빈도")).toBeNull();

    cleanup();
    render(
      <AutomationEditor
        value={blankDefinition("2026-08-31")}
        isNew
        busy={false}
        onCancel={noop}
        onSave={noop}
      />
    );
    expect(screen.getByText("빈도")).toBeInTheDocument();
    expect(screen.queryByText("감시 경로")).toBeNull();
  });

  it("여섯 티어를 전부 고를 수 있고 도움말이 상시 보인다", () => {
    render(
      <AutomationEditor
        value={blankDefinition("2026-08-31", "watcher")}
        isNew
        busy={false}
        onCancel={noop}
        onSave={noop}
      />
    );
    for (const label of ["즉시 (0.2초)", "보통 (1초)", "느긋 (3초)", "여유 (1분)", "지연 (5분)", "길게 (10분)"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
    // 문제 해결 문구도 같은 말("지시문은 그대로 모델에게 갑니다")을 쓴다 —
    // 그게 §2.5 의 요구다. 그래서 여기서는 존재만 확인한다.
    expect(screen.getAllByText(/그대로 모델에게 갑니다/).length).toBeGreaterThan(0);
    expect(screen.getByText(/이미 처리한 것은 건너뛰라고 명시/)).toBeInTheDocument();
    expect(screen.getByText(/손이 멎은 뒤에만 돕니다/)).toBeInTheDocument();
    // 문제 해결 3종은 에디터와 목록이 같은 말을 쓴다.
    expect(screen.getByText("결과가 이상하다 —")).toBeInTheDocument();
  });

  it("종류를 바꾸면 화면도 반대편 축으로 바뀐다", () => {
    render(
      <AutomationEditor
        value={blankDefinition("2026-08-31")}
        isNew
        busy={false}
        onCancel={noop}
        onSave={noop}
      />
    );
    expect(screen.getByText("빈도")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("스케줄 (시계에 반응)"), {
      target: { value: "watcher" },
    });
    expect(screen.getByText("감시 경로")).toBeInTheDocument();
    expect(screen.queryByText("빈도")).toBeNull();
  });
});
