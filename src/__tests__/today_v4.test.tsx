import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

import type {
  ClaudePluginStatus,
  DigestPlan,
  JournalEntrySummary,
  JournalMissingSignal,
  Session,
  TodayDigest,
} from "@/lib/bindings";

// ─── 4.0 오늘 — 예외만 보여 준다 ─────────────────────────────────────────────
//
// 이 스위트가 무는 계약:
//  1. 「먼저 볼 것」은 지금 손댈 다섯 종류(실패 → 일지 없는 변경 → 일지 없이 끝난 대화 → 막힘 →
//     플러그인 새 판)만 심각도 순으로. 검증 없이 끝난 일지는 그 아래 한 묶음, 내 차례는 한 줄
//     (화면 검사 {#today-split} · {#today-mine}).
//  2. 비었으면 차분한 한 문단 — 못 읽은 것은 없다고 말하지 않는다.
//  3. 증거가 다 선 묶음은 접힌다. 하루 60건이면 펼쳐진 것은 확인할 것뿐이고,
//     3건이면 셋 다 보인다 — 같은 화면, 모드 없음.
//  4. 「읽음」은 `oculpm_set_journal_verified` 를 부른다 (버튼 · v 키), 「모두 읽음」은 _bulk 한 번.
//  5. 키보드는 화면 안에서만 — j/k 이동, Enter 기본 동작, 입력칸 안에서는 무시.

const WORKDAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
})();

const fx = vi.hoisted(() => ({
  entries: [] as unknown[],
  total: 0,
  digest: null as unknown,
  unrecorded: [] as string[],
  compareFails: false,
  missing: [] as unknown[],
  plugin: null as unknown,
  sessions: [] as unknown[],
  verifyCalls: [] as Array<[string, boolean]>,
  dispatchCalls: [] as Array<[string, string]>,
}));

// 「다음」 은 앱 안 터미널에서 실행된다 — 터미널(xterm)은 띄우지 않고 넘긴 프롬프트만 본다.
const runs: string[] = [];
vi.mock("@/features/terminal/runPrompt", () => ({
  runPromptInTerminal: async (_projectId: number, prompt: string) => {
    runs.push(prompt);
  },
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "oculpmWorkdayBrief":
              return (_p: number, workdays: string[]) =>
                ok({
                  days: workdays.map((wd) => ({ workday: wd, entries: fx.entries })),
                  lines_added: 0,
                  lines_removed: 0,
                  files_touched: 0,
                  open_plan_items: [],
                  total_entries: fx.total,
                });
            case "todayDigest":
              return () => ok(fx.digest);
            case "oculpmCompareWorkday":
              return () =>
                fx.compareFails
                  ? Promise.reject(new Error("boom"))
                  : ok({
                  workday: WORKDAY,
                  sessions: [{ session_id: `${WORKDAY}-001`, unrecorded: fx.unrecorded, unrecorded_severity: "warning" }],
                  unrecorded_total: fx.unrecorded.length,
                });
            case "journalMissingSignals":
              return () => ok(fx.missing);
            case "claudePluginStatus":
              return () => ok(fx.plugin);
            case "oculpmListSessions":
              return () => ok(fx.sessions);
            case "oculpmSetJournalVerified":
              return (_p: number, path: string, on: boolean) => {
                fx.verifyCalls.push([path, on]);
                return ok(null);
              };
            case "oculpmSetJournalVerifiedBulk":
              return (_p: number, paths: string[], on: boolean) => {
                for (const path of paths) fx.verifyCalls.push([path, on]);
                return ok({ updated: paths.length, skipped: [] });
              };
            case "planDispatchPrompt":
              return (_p: number, planId: string, itemId: string) => {
                fx.dispatchCalls.push([planId, itemId]);
                return ok({ file_rel: "x", command: "x", prompt: "PROMPT", item_title: "다음 항목" });
              };
            case "settingsGetAll":
              return () => ok([] as Array<[string, string]>);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { t } from "@/i18n";

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } } as const;

function entry(i: number, over: Partial<JournalEntrySummary> = {}): JournalEntrySummary {
  const hh = String(9 + Math.floor(i / 6)).padStart(2, "0");
  const mm = String((i * 7) % 60).padStart(2, "0");
  return {
    relative_path: `${WORKDAY}/Features_to_add/${hh}${mm}_feature_e${i}.md`,
    workday: WORKDAY,
    type: "feature",
    slug: `e${i}`,
    status: "done",
    difficulty: null,
    title: `일지 ${i}`,
    checkbox: null,
    session_id: `${WORKDAY}-001`,
    agent_id: "claude-code",
    agent_version: null,
    verified_by_user: false,
    verified_stale: false,
    evidence: 2,
    created_at: new Date(new Date().setHours(Number(hh), Number(mm), 0, 0)).toISOString(),
    updated_at: null,
    tags: [],
    files_count: 2,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

function plan(id: string, over: Partial<DigestPlan> = {}): DigestPlan {
  return {
    plan_id: id,
    title: `계획 ${id}`,
    progress: 0.5,
    done_count: 2,
    item_count: 4,
    updated_at: "2026-10-28",
    done_when: "끝나면 끝",
    check: "pnpm test",
    last_verdict: null,
    next: null,
    ...over,
  };
}

function digest(over: Partial<TodayDigest> = {}): TodayDigest {
  return { plans: [], needs_user: [], blocked: [], journal_plan: [], ...over };
}

function renderToday(onNavigate = vi.fn(), onOpenEntry = vi.fn()) {
  const utils = render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <TodayScreenV2
          projectId={1}
          workday={WORKDAY}
          oculpmReady
          onNavigate={onNavigate}
          onOpenEntry={onOpenEntry}
          dateLabel="10월 29일"
        />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
  return { ...utils, onNavigate, onOpenEntry };
}

const checkCard = () => screen.getByRole("region", { name: t("today.check.title") });
const unreadCard = () => screen.getByRole("region", { name: t("today.unread.title") });
const pills = () =>
  within(checkCard())
    .queryAllByRole("listitem")
    .map((li) => li.querySelector(".chip")?.textContent);

beforeEach(() => {
  fx.entries = [];
  fx.total = 10;
  fx.digest = digest();
  fx.unrecorded = [];
  fx.compareFails = false;
  fx.missing = [];
  fx.plugin = { installed: true, behind: false, installed_version: "4.0.0", bundled_version: "4.0.0", path: "/p", scope: "user" } satisfies ClaudePluginStatus;
  fx.sessions = [];
  fx.verifyCalls = [];
  fx.dispatchCalls = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
});
afterEach(() => cleanup());

describe("확인할 것 — 종류와 순서", () => {
  it("먼저 볼 것은 지금 손댈 다섯 종류 — 검증 없는 일지는 아래 묶음, 내 차례는 한 줄", async () => {
    fx.entries = [entry(1, { type: "bug", evidence: 0, title: "새 폴더 감시 경합" }), entry(2)];
    fx.digest = digest({
      plans: [plan("a", { last_verdict: { passed: false, summary: "2 failed, 418 passed", ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x" } })],
      blocked: [{ plan_id: "a", plan_title: "계획 a", item_id: "hook", title: "시작 훅", status: "blocked" }],
      needs_user: [{ plan_id: "b", plan_title: "계획 b", item_id: "tag", title: "[사용자] v4.0.0 태그", status: "todo" }],
    });
    fx.unrecorded = ["src/a.ts", "src/b.ts"];
    fx.missing = [{ ts: new Date().toISOString(), session_id: "conv-1234567890", segments: 1 } satisfies JournalMissingSignal];
    fx.plugin = { installed: true, behind: true, installed_version: "3.3.0", bundled_version: "4.0.0", path: "/p", scope: "project" } satisfies ClaudePluginStatus;
    renderToday();

    await waitFor(() => expect(pills()).toHaveLength(5));
    expect(pills()).toEqual([
      t("today.check.kind.verdict"),
      t("today.check.kind.unrecorded"),
      t("today.check.kind.unrecorded"),
      t("today.check.kind.blocked"),
      t("today.check.kind.plugin"),
    ]);
    // 검증 없는 일지는 딱지 없이 아래 묶음에 — 이유는 묶음 머리가 말한다.
    const unread = within(unreadCard()).getAllByRole("listitem");
    expect(unread).toHaveLength(1);
    expect(unread[0].querySelector(".chip")).toBeNull();
    expect(within(unread[0]).getByText("새 폴더 감시 경합")).toBeInTheDocument();
    // 내 차례는 행이 아니라 한 줄 — 계획 수와 항목 수만.
    expect(screen.getByText(t("today.mine.line", { p: 1, n: 1 }))).toBeInTheDocument();
    const card = checkCard();
    // 판정 실패 행은 결과 끝 줄(에이전트의 말이 아니라)을 보여 준다.
    expect(within(card).getByText(/2 failed, 418 passed/)).toBeInTheDocument();
    expect(within(card).getByText(t("today.check.unrecordedTitle", { n: 2 }))).toBeInTheDocument();
    expect(within(card).getByText(/3\.3\.0 → 4\.0\.0/)).toBeInTheDocument();
  });

  it("증거를 요구하지 않는 종류(잡일·에러 사이클)와 사람이 확인한 일지는 예외가 아니다", async () => {
    fx.entries = [
      entry(1, { type: "chore", evidence: 0 }),
      entry(2, { type: "error", evidence: 1 }),
      entry(3, { type: "refactor", evidence: 0, verified_by_user: true }),
    ];
    renderToday();
    expect(await screen.findByText(t("today.check.emptyTitle"))).toBeInTheDocument();
  });

  it("확인 뒤 내용이 바뀐 일지는 다시 확인할 것이 된다", async () => {
    fx.entries = [entry(1, { type: "refactor", evidence: 0, verified_by_user: true, verified_stale: true })];
    renderToday();
    expect(await screen.findByText(new RegExp(t("today.check.evidenceStale")))).toBeInTheDocument();
  });

  it("비었으면 차분한 한 문단 — 오늘 기록 수와 함께", async () => {
    fx.entries = [entry(1), entry(2), entry(3)];
    renderToday();
    expect(await screen.findByText(t("today.check.emptyTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("today.check.emptyBody", { n: 3 }))).toBeInTheDocument();
  });

  it("기록 없는 변경을 못 읽었으면 「없어요」라고 말하지 않는다", async () => {
    fx.entries = [entry(1)];
    fx.compareFails = true;
    renderToday();
    expect(await screen.findByText(t("today.check.emptyBodyUnknown", { n: 1 }))).toBeInTheDocument();
  });
});

describe("확인할 것 — 동작", () => {
  it("「확인함」이 oculpm_set_journal_verified 를 부르고 행이 빠진다", async () => {
    fx.entries = [entry(1, { type: "bug", evidence: 1, title: "증거 없는 수정" })];
    renderToday();
    const btn = await screen.findByRole("button", { name: t("today.check.verifyAria", { title: "증거 없는 수정" }) });
    fireEvent.click(btn);
    await waitFor(() => expect(fx.verifyCalls).toEqual([[(fx.entries[0] as JournalEntrySummary).relative_path, true]]));
    await waitFor(() => expect(pills()).toHaveLength(0));
  });

  it("일지 행은 제목이 그 일지 상세로(버튼은 「확인함」 하나), [출력 보기]·[계획 열기] 는 그 계획으로 간다", async () => {
    fx.entries = [entry(1, { type: "bug", evidence: 0 })];
    fx.digest = digest({
      plans: [plan("a", { last_verdict: { passed: false, summary: "1 failed", ts: new Date().toISOString(), agent_id: "codex", item_id: "x" } })],
    });
    const { onNavigate, onOpenEntry } = renderToday();
    const row = await screen.findByRole("listitem", { name: new RegExp((fx.entries[0] as JournalEntrySummary).title) });
    expect(within(row).getAllByRole("button")).toHaveLength(2); // 제목 · 확인함
    fireEvent.click(within(row).getByRole("button", { name: (fx.entries[0] as JournalEntrySummary).title }));
    expect(onOpenEntry).toHaveBeenCalledWith({ relative_path: (fx.entries[0] as JournalEntrySummary).relative_path });
    fireEvent.click(screen.getByRole("button", { name: t("today.check.openOutput") }));
    expect(onNavigate).toHaveBeenCalledWith("planner");
  });

  it("키보드 — j/k 이동, Enter 기본 동작, v 확인함, 입력칸 안에서는 무시", async () => {
    fx.entries = [entry(1, { type: "bug", evidence: 0, title: "첫째" })];
    fx.digest = digest({
      plans: [plan("a", { last_verdict: { passed: false, summary: "", ts: new Date().toISOString(), agent_id: "codex", item_id: "x" } })],
    });
    const { container, onNavigate } = renderToday();
    await waitFor(() => expect(pills()).toHaveLength(1));
    const root = container.querySelector(".page.tdy") as HTMLElement;
    // 두 칸의 행은 한 목록 — 먼저 볼 것 다음에 검증 없는 일지.
    const rows = [...within(checkCard()).getAllByRole("listitem"), ...within(unreadCard()).getAllByRole("listitem")];

    fireEvent.keyDown(root, { key: "j" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: "k" });
    expect(document.activeElement).toBe(rows[0]);

    // 판정 실패 행에서 Enter → 그 계획.
    fireEvent.keyDown(rows[0], { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("planner");

    // 판정 행에서 v 는 아무것도 하지 않는다 — 확인함은 일지 행의 것.
    fireEvent.keyDown(rows[0], { key: "v" });
    expect(fx.verifyCalls).toEqual([]);

    fireEvent.keyDown(rows[0], { key: "j" });
    fireEvent.keyDown(rows[1], { key: "v" });
    await waitFor(() => expect(fx.verifyCalls).toHaveLength(1));

    // 입력칸 안의 j 는 글자다.
    const input = document.createElement("input");
    root.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "j" });
    expect(document.activeElement).toBe(input);
  });

  it("「모두 읽음」 은 묶음의 일지를 한 번에 표시하고 묶음이 빠진다", async () => {
    fx.entries = [entry(1, { type: "bug", evidence: 0, title: "하나" }), entry(2, { type: "feature", evidence: 0, title: "둘" })];
    renderToday();
    fireEvent.click(within(await screen.findByRole("region", { name: t("today.unread.title") })).getByRole("button", { name: t("today.unread.allRead") }));
    await waitFor(() => expect(fx.verifyCalls.map(([, on]) => on)).toEqual([true, true]));
    await waitFor(() => expect(screen.queryByRole("region", { name: t("today.unread.title") })).toBeNull());
  });

  it("r 은 다음 항목을 앱 안 터미널에서 실행한다 (클립보드 경로는 걷었다)", async () => {
    fx.entries = [entry(1)];
    fx.digest = digest({
      plans: [plan("a", { next: { plan_id: "a", plan_title: "계획 a", item_id: "drop-tray", title: "트레이 제거", status: "todo" } })],
    });
    const { container } = renderToday();
    expect(await screen.findByText("트레이 제거")).toBeInTheDocument();
    runs.length = 0;
    fireEvent.keyDown(container.querySelector(".page.tdy") as HTMLElement, { key: "r" });
    await waitFor(() => expect(fx.dispatchCalls).toEqual([["a", "drop-tray"]]));
    await waitFor(() => expect(runs).toEqual(["PROMPT"]));
  });
});

describe("오늘 한 일 — 같은 화면, 모드 없음", () => {
  it("하루 60건: 묶음은 머리 한 줄로 접히고, 검증 없는 일지는 위 칸이 보여 준다", async () => {
    const all: JournalEntrySummary[] = [];
    for (let i = 0; i < 60; i++) {
      all.push(entry(i, i === 7 ? { type: "bug", evidence: 0, title: "새 폴더 감시 경합" } : i % 11 === 0 ? { verified_by_user: true, evidence: 0, type: "chore" } : {}));
    }
    fx.entries = all;
    fx.total = 900;
    fx.digest = digest({
      plans: [plan("drop", { title: "4.0 덜어내기" }), plan("port", { title: "크로스플랫폼 포팅" })],
      journal_plan: [
        ...all.slice(0, 23).map((e) => ({ journal_ref: `journal/${e.relative_path}`, plan_id: "drop", plan_title: "4.0 덜어내기", item_id: "x" })),
        ...all.slice(23, 27).map((e) => ({ journal_ref: `.oculpm/journal/${e.relative_path}`, plan_id: "port", plan_title: "크로스플랫폼 포팅", item_id: "y" })),
      ],
    });
    const { container } = renderToday();
    // 남은 예외가 검증 없는 일지 하나뿐이면 「먼저 볼 것」 칸은 서지 않는다.
    await waitFor(() => expect(within(unreadCard()).getAllByRole("listitem")).toHaveLength(1));
    expect(screen.queryByRole("region", { name: t("today.check.title") })).toBeNull();
    // 「나머지 N건은 접었어요」 는 걷었다 — 9 와 44 처럼 단위가 다른 수가 나란히 섰다 (화면 검사 {#today-sum}).
    expect(screen.queryByText(/접었어요/)).toBeNull();

    const work = screen.getByRole("region", { name: t("today.work.title") });
    const heads = within(work).queryAllByRole("button", { expanded: true }).concat(within(work).queryAllByRole("button", { expanded: false }));
    expect(heads).toHaveLength(3);
    expect(within(work).getByRole("button", { name: /4\.0 덜어내기/, expanded: false })).toBeInTheDocument();
    expect(within(work).getByRole("button", { name: /크로스플랫폼 포팅/, expanded: false })).toBeInTheDocument();
    expect(within(work).getByRole("button", { name: new RegExp(t("today.work.outside")), expanded: false })).toBeInTheDocument();
    // 묶음 머리는 예외 수만 — 「검증 n · 없음 m」 은 검증 대상이 아닌 일지를 빼먹어 합이 안 맞았다.
    expect(work.querySelector(".tdy-ok")).toBeNull();
    expect(within(work).getByText(t("today.work.missing", { n: 1 }))).toBeInTheDocument();
    // 같은 행을 두 번 세우지 않는다 — 검증 없는 일지는 위 칸에만.
    expect(container.querySelectorAll(".tdy-ent")).toHaveLength(0);
    expect(within(unreadCard()).getByText("새 폴더 감시 경합")).toBeInTheDocument();

    // 머리를 누르면 펼친다.
    fireEvent.click(within(work).getByRole("button", { name: /크로스플랫폼 포팅/ }));
    expect(container.querySelectorAll(".tdy-ent")).toHaveLength(4);
    fireEvent.click(within(work).getByRole("button", { name: /4\.0 덜어내기/ }));
    expect(container.querySelectorAll(".tdy-ent")).toHaveLength(27);

    // 시간순은 전부 한 줄씩.
    fireEvent.click(within(work).getByRole("tab", { name: t("today.work.byTime") }));
    expect(container.querySelectorAll(".tdy-ent")).toHaveLength(60);

    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });

  it("하루 3건: 셋 다 보이고, 묶음 머리도 세그먼트도 없다", async () => {
    fx.entries = [entry(1), entry(2, { type: "bug" }), entry(3, { type: "chore" })];
    const { container } = renderToday();
    await waitFor(() => expect(container.querySelectorAll(".tdy-ent")).toHaveLength(3));
    expect(container.querySelector(".tdy-grp")).toBeNull();
    expect(screen.queryByRole("tab", { name: t("today.work.byTime") })).toBeNull();
    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });
});

describe("한 칼럼과 첫 기록 전", () => {
  it("계획 카드는 없고(계획 탭 몫), 오래 조용한 세션은 경고 한 줄을 갖는다", async () => {
    fx.entries = [entry(1)];
    fx.digest = digest({
      plans: [
        plan("p", { title: "통과한 계획", last_verdict: { passed: true, summary: "ok", ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x" } }),
        plan("n", { title: "판정 없는 계획" }),
      ],
    });
    // 50분 30초 — 공유 분 시계의 스냅숏이 몇백 ms 늦어도 「50분째」로 읽힌다.
    const started = new Date(Date.now() - 50.5 * 60_000).toISOString();
    fx.sessions = [
      {
        id: `${WORKDAY}-002`,
        started_at: started,
        ended_at: null,
        ended_reason: null,
        active_window_ms: 0,
        file_event_count: 3,
        files_unique: 2,
        git_head_at_start: null,
        git_head_at_end: null,
        agent_label_guess: "codex",
        linked_journal_entries: [],
      } satisfies Session,
    ];
    renderToday();
    const live = await screen.findByRole("region", { name: t("today.live.title") });
    // 통과한 판정은 예외가 아니다 — 오늘에는 서지 않고 계획 탭에 있다.
    expect(screen.queryByText("통과한 계획")).toBeNull();
    expect(within(live).getByText(t("today.live.quiet", { n: 50 }))).toBeInTheDocument();
  });

  it("일지가 0건이면 짧은 안내 하나 — 에이전트 연결로", async () => {
    fx.total = 0;
    const { onNavigate } = renderToday();
    fireEvent.click(await screen.findByRole("button", { name: t("today.first.connect") }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(screen.queryByRole("region", { name: t("today.check.title") })).toBeNull();
  });
});
