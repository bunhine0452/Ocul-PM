// 최종 검수 고침 (11-15 fix-screens) — 화면을 건너는 것들. 같은 판정 상태의 아래 줄은 오늘과 계획이 같은 문장이고
// (RC-17), 다시 읽다 실패한 한 줄은 두 화면이 같은 꼴이며(RC-11), 오늘의 「N건 더」 는 그날의 수라 일지 화면도
// 그날로 좁혀 선다(SCR-05). 화면마다 가짜 백엔드가 달라 `screenMux` 로 갈아 끼운다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/bindings", async (orig) => (await import("./screenMux")).muxBindings(await orig<typeof import("@/lib/bindings")>()));
vi.mock("@/api/oculpm", async (orig) => (await import("./screenMux")).muxOculpm(await orig<typeof import("@/api/oculpm")>()));
vi.mock("@/api/plan", async (orig) => (await import("./screenMux")).muxPlan(await orig<typeof import("@/api/plan")>()));
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {}, runGoalInTerminal: async () => true }));
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { SettingsProvider } from "@/contexts/SettingsContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { JournalScreenV2, __resetJournalMemory } from "@/features/oculpm/JournalScreenV2";
import { resetOnlyMissing } from "@/features/oculpm/onlyMissing";
import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { emit as busEmit, entry as journalEntry, jfx, resetJournalFixtures } from "./journalHarness";
import { detail, item, pfx, plan as planSummary, resetPlanFixtures, stage, verdict } from "./plannerHarness";
import { mux } from "./screenMux";
import { digest, entry as todayEntry, fx, plan as digestPlan, resetFx, WORKDAY } from "./todayFixture";
import { renderToday } from "./todayRender";

function renderPlanner() {
  mux.screen = "planner";
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <PlannerScreenV2 projectId={1} onNavigate={vi.fn()} onOpenJournal={vi.fn()} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  resetFx();
  resetPlanFixtures();
  resetJournalFixtures();
  __resetJournalMemory();
  resetOnlyMissing();
});
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

const PASS = { passed: true, summary: "12 passed", ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x" };

/** 오늘 「먼저 볼 것」 의 판정 행 아래 줄. */
async function todaySub(kind: string): Promise<HTMLElement> {
  mux.screen = "today";
  const { container } = renderToday();
  await waitFor(() => expect(container.querySelector(`.tdy-row[data-kind="${kind}"] .vl-sub`)).not.toBeNull());
  return container.querySelector(`.tdy-row[data-kind="${kind}"] .vl-sub`) as HTMLElement;
}

/** 계획 판정 카드의 아래 줄. */
async function planSub(title: string): Promise<HTMLElement> {
  const { container } = renderPlanner();
  await screen.findByRole("heading", { level: 2, name: title });
  await waitFor(() => expect(container.querySelector(".plv-judge-last .vl-sub")).not.toBeNull());
  return container.querySelector(".plv-judge-last .vl-sub") as HTMLElement;
}

describe("RC-17 — the same verdict state, the same words on Today and in the plan", () => {
  it("passed on another OS: both say the one 'passed on Windows · not on this machine yet'", async () => {
    fx.digest = digest({ plans: [digestPlan("w", { title: "Away plan", last_verdict: PASS, verdict_from: "windows" })] });
    const want = t("state.verdict.awaySub", { os: "Windows" });
    expect((await todaySub("elsewhere")).textContent).toContain(want);
    cleanup();
    stage([detail(planSummary("w", { title: "Away plan", last_verdict: verdict(), verdict_from: "windows" }), [item("a", "todo", 0)])]);
    expect((await planSub("Away plan")).textContent).toContain(want);
  });

  it("changed after the pass: both name the first file (machine text) and 'and N more', not a bare count", async () => {
    const files = ["src/a.ts", "src/b.ts"];
    fx.digest = digest({ plans: [digestPlan("s", { title: "Stale plan", last_verdict: PASS, stale_files: files })] });
    const want = t("state.verdict.staleSub", { files: t("today.check.moreFiles", { first: "src/a.ts", n: 1 }) });
    const today = await todaySub("stale");
    expect(today.textContent).toContain(want);
    expect(today.querySelector(".mono:not(code)")?.textContent).toBe("src/a.ts");
    cleanup();
    stage([detail(planSummary("s", { title: "Stale plan", last_verdict: verdict(), stale_files: files }), [item("a", "todo", 0)])]);
    const planned = await planSub("Stale plan");
    expect(planned.textContent).toContain(want);
    expect(planned.querySelector(".mono")?.textContent).toBe("src/a.ts");
    // 툴팁의 전문은 줄이지 않는다.
    expect(planned.getAttribute("title")).toContain(t("state.verdict.staleSub", { files: files.join(", ") }));
  });
});

describe("RC-11 — a failed reread is one shape on Today and in the plan", () => {
  /** 꼴만 — 태그 · 역할 · 클래스와 자식들의 태그 · 클래스. 시각 글자는 뺀다. */
  const shape = (el: Element): unknown => ({
    tag: el.tagName,
    role: el.getAttribute("role"),
    cls: el.className,
    kids: [...el.children].map(shape),
  });

  // 사건 채널(`useOculpmLive` 의 모듈 상수)은 처음 불러올 때의 화면(`mux` 의 첫 값 journal) 가짜에 묶인다 — 그래서
  // 두 화면 모두 그 버스(`journalHarness.emit`)로 디스크 변경을 알린다.
  it("'HH:MM couldn't read since' (time in machine text) + the shared retry link, no chip", async () => {
    mux.screen = "today";
    fx.entries = [todayEntry(1, { type: "bug", evidence: 0 })];
    renderToday();
    await waitFor(() => expect(document.querySelector(".tdy-unread")).not.toBeNull());
    fx.fail.add("oculpmWorkdayBrief");
    act(() => busEmit("oculpmJournalUpdated", { project_id: 1 }));
    await waitFor(() => expect(document.querySelector(".stale-note")).not.toBeNull());
    const today = shape(document.querySelector(".stale-note")!);
    cleanup();

    stage([detail(planSummary("k", { title: "Kept" }), [item("x", "todo", 0)])]);
    renderPlanner();
    await screen.findByRole("heading", { level: 2, name: "Kept" });
    pfx.failGet = 1;
    act(() => busEmit("oculpmDataChanged", { project_id: 1, area: "planner" }));
    await waitFor(() => expect(document.querySelector(".stale-note")).not.toBeNull());
    expect(shape(document.querySelector(".stale-note")!)).toEqual(today);
    expect(within(document.querySelector(".stale-note") as HTMLElement).getByRole("button").textContent).toBe(t("common.retry"));
  });
});

describe("SCR-05 — Today's 'N more' counts that day, and the journal stands on that day", () => {
  const todayRows = Array.from({ length: 8 }, (_, i) =>
    journalEntry({ relative_path: `${WORKDAY}/B/1${i}00_t${i}.md`, workday: WORKDAY, title: `today ${i}`, type: "bug", evidence: 0, created_at: `2026-11-15T1${i}:00:00+09:00` }),
  );
  const olderRows = Array.from({ length: 30 }, (_, i) =>
    journalEntry({ relative_path: `20260101/B/0${i % 10}${i}_o${i}.md`, workday: "20260101", title: `older ${i}`, type: "bug", evidence: 0, created_at: "2026-01-01T09:00:00+09:00" }),
  );
  const rows = (c: HTMLElement) => c.querySelectorAll(".jl-item").length;

  it("'3 more' → the journal shows today's 8 unverified with a pressed 'today only'; pressing it widens to all 38", async () => {
    mux.screen = "today";
    fx.entries = Array.from({ length: 8 }, (_, i) => todayEntry(i + 1, { type: "bug", evidence: 0 }));
    const { onNavigate } = renderToday();
    const unread = await screen.findByRole("region", { name: t("today.unread.title") });
    await waitFor(() => expect(within(unread).getAllByRole("listitem")).toHaveLength(5));
    fireEvent.click(within(unread).getByRole("button", { name: t("today.unread.more", { n: 3 }) }));
    expect(onNavigate).toHaveBeenCalledWith("journal");
    cleanup();

    mux.screen = "journal";
    jfx.byWorkday[WORKDAY] = todayRows;
    jfx.allPeriod = [...todayRows, ...olderRows];
    const { container } = render(
      <WorkspaceProvider projectId={1}>
        <JournalScreenV2 projectId={1} todayKey={WORKDAY} oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(rows(container)).toBe(8));
    const [only, scope] = [...container.querySelectorAll<HTMLButtonElement>(".jl-only")];
    expect(only).toHaveAttribute("aria-pressed", "true");
    expect(only.querySelector(".jl-warn-n")?.textContent).toBe("8");
    expect(scope).toHaveAttribute("aria-pressed", "true");
    expect(scope.textContent).toBe(t("journal.dayScope", { day: t("journal.day.today") }));
    expect(scope.title).toBe(t("journal.dayScopeTitle"));

    fireEvent.click(scope);
    await waitFor(() => expect(rows(container)).toBe(38));
    expect(container.querySelector(".jl-only .jl-warn-n")?.textContent).toBe("38");
    expect(container.querySelectorAll(".jl-only")).toHaveLength(1);
  });
});
