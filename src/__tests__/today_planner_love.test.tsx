// 사랑할 만하게 라운드 G1 (11-23, 계획 love-round-20261123) — 오늘 · 계획의 예외가 한눈에 서게.
//
// 판정 실패 행은 어느 계획인지가 먼저(확인 명령은 맨 끝이라 먼저 잘린다), 시각은 다른 행처럼 아래 줄 끝. 「오늘 한 일」
// 의 제목이 가장 넓다(종류 이름 칸 · 「파일 12」 를 걷었다). 볼 것도 「다음」 도 없으면 빈 상태에 다음 한 동작 하나.
// 머리의 수와 탭 배지는 한 규칙 · 한 이름. 계획 목록은 먼저 볼 계획 · 닫을 계획을 앞세우고 무리마다 수를 단다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { navBadgesOf } from "@/features/shell/useNavBadges";
import { PlanRail } from "@/features/planner/PlanRail";
import { inCloseGroup, railGroups, railOrder } from "@/features/planner/planList";
import { countedExceptions } from "@/features/today/todayModel";
import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { en } from "@/i18n/en";
import { ko } from "@/i18n/ko";
import type { PlanSummary } from "@/lib/bindings";
import { digest, entry, fx, plan, resetFx } from "./todayFixture";
import { renderToday } from "./todayRender";

const LONG_CHECK = "pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked";
const failed = { passed: false, summary: "Tests 2 failed | 1966 passed", ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x" };

beforeEach(() => resetFx());
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

describe("a failed verdict row says which plan first", () => {
  it("puts the plan name before the check command, and the time at the end of the line under it", async () => {
    fx.digest = digest({ plans: [plan("f", { title: "Release round", check: LONG_CHECK, last_verdict: failed })] });
    const { container } = renderToday();
    await waitFor(() => expect(container.querySelector('.tdy-row[data-kind="verdict"] .vl-sub')).not.toBeNull());
    const row = container.querySelector('.tdy-row[data-kind="verdict"]') as HTMLElement;
    const sub = row.querySelector(".vl-sub") as HTMLElement;
    const text = sub.textContent ?? "";
    const planAt = text.indexOf(t("today.check.inPlan", { plan: "Release round" }));
    expect(planAt).toBeGreaterThanOrEqual(0);
    expect(planAt).toBeLessThan(text.indexOf(LONG_CHECK));
    // 시각은 첫 줄이 아니라 아래 줄 끝 — 잘리는 칸(.vl-sub-t) 밖이라 늘 보인다.
    expect(row.querySelector(".vl > .vl-when")).toBeNull();
    expect(sub.lastElementChild?.className).toBe("vl-when");
    expect(sub.querySelector(".vl-sub-t .vl-when")).toBeNull();
    // 툴팁의 전문도 같은 차례다.
    expect(sub.querySelector(".vl-sub-t")?.getAttribute("title")).toBe(`${t("today.check.inPlan", { plan: "Release round" })} · ${LONG_CHECK}`);
  });
});

describe("done today gives the title the room", () => {
  it("drops the kind name and writes the file count as a number, the meaning kept for tooltips and screen readers", async () => {
    fx.entries = [entry(1, { title: "Terminal: Ctrl+C runs too", files_count: 12, type: "bug" })];
    const { container } = renderToday();
    await screen.findByRole("region", { name: t("today.work.title") });
    const row = container.querySelector(".tdy-ent") as HTMLElement;
    expect(row.querySelector(".tdy-ent-ty")).toBeNull();
    expect(row.textContent).not.toContain(t("trigger.bug"));
    expect(row.getAttribute("title")).toBe(`${t("trigger.bug")} · Terminal: Ctrl+C runs too`);
    const files = row.querySelector(".tdy-ent-ln") as HTMLElement;
    expect(files.querySelector('[aria-hidden="true"]')?.textContent).toBe("12");
    expect(files.querySelector(".tdy-sr")?.textContent).toBe(t("today.work.files", { n: 12 }));
    expect(files.getAttribute("title")).toBe(t("today.work.files", { n: 12 }));
  });
});

describe("an empty card still has one next action", () => {
  it("offers the plan screen when nothing needs a look and nothing is next", async () => {
    fx.entries = [entry(1)];
    const { onNavigate } = renderToday();
    const card = await screen.findByRole("region", { name: t("today.check.title") });
    expect(within(card).getByText(t("today.check.emptyTitle"))).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: t("today.check.openPlans") }));
    expect(onNavigate).toHaveBeenCalledWith("planner");
  });

  it("leaves it out when the Next row is there — that row is the action", async () => {
    fx.entries = [entry(1)];
    fx.digest = digest({ plans: [plan("n", { next: { plan_id: "n", plan_title: "plan n", item_id: "go", title: "go", status: "todo" } })] });
    renderToday();
    const card = await screen.findByRole("region", { name: t("today.check.title") });
    await within(card).findByText("go");
    expect(within(card).queryByRole("button", { name: t("today.check.openPlans") })).toBeNull();
  });
});

describe("one count, one name", () => {
  it("counts the card head and the tab badge by the same rule, so a plugin row moves neither", async () => {
    fx.digest = digest({ plans: [plan("f", { last_verdict: failed })] });
    fx.plugin = { state: "connected", ahead: false, other_behind: 0, app_reachable: true, installed: true, behind: true, installed_version: "3.0.0", bundled_version: "4.0.0", path: "/p", scope: "user" };
    const { container } = renderToday();
    await waitFor(() => expect(container.querySelectorAll(".tdy-rows .tdy-row")).toHaveLength(2));
    const card = screen.getByRole("region", { name: t("today.check.title") });
    expect(card.querySelector(".tdy-cnt")?.textContent).toBe("1");
    const rows = [{ kind: "verdict" }, { kind: "plugin" }];
    expect(countedExceptions(rows)).toEqual([{ kind: "verdict" }]);
    expect(navBadgesOf(null, undefined, { todayRows: rows }).today).toEqual({ n: 1, tone: "danger", title: t("nav.badgeTitleFail", { n: 1, m: 1 }) });
  });

  it("names the badge with the card's words in both languages", () => {
    expect(ko["nav.badgeTitle"].replace(" {n}", "")).toBe(ko["today.check.title"]);
    expect(en["nav.badgeTitle"].replace(" {n}", "")).toBe(en["today.check.title"]);
    const banned = Object.entries(ko).filter(([, v]) => v.includes("손댈 것")); // i18n-ignore -- 금지어 검사 재료
    expect(banned.map(([k]) => k)).toEqual([]);
  });

  it("calls a journal a journal on the first screens", () => {
    for (const k of ["today.first.title", "today.first.body", "today.live.noneYet", "today.live.quiet", "today.live.quietHours", "today.live.restQuiet", "start.noRecords"] as const) {
      expect(ko[k], k).not.toMatch(/기록/); // i18n-ignore -- 금지어 검사 재료
      expect(ko[k], k).toMatch(/일지/); // i18n-ignore -- 낱말 검사 재료
    }
  });
});

function summary(id: string, over: Partial<PlanSummary> = {}): PlanSummary {
  return {
    plan_id: id,
    title: `plan ${id}`,
    status: "active",
    owner_agent: "claude-code",
    progress: 0.5,
    file_path: `.oculpm/planner/${id}.md`,
    updated_at: "2026-11-01",
    item_count: 4,
    done_count: 2,
    ...over,
  };
}

describe("the plan list puts exceptions first", () => {
  const pass = { passed: true, summary: "12 passed", ts: "2026-11-20T10:00:00+09:00", agent_id: "claude-code", item_id: "x" };
  const fail = { ...pass, passed: false, summary: "1 failed" };
  const plans = [
    summary("new", { updated_at: "2026-11-22", last_verdict: pass }),
    summary("closeA", { updated_at: "2026-11-21", closable: true, done_count: 4 }),
    summary("stale", { updated_at: "2026-11-20", last_verdict: pass, stale_files: ["src/a.ts"] }),
    summary("old-fail", { updated_at: "2026-09-01", last_verdict: fail }),
    summary("closeB", { updated_at: "2026-10-01", closable: true, done_count: 3, item_count: 4 }),
    summary("done", { status: "done", updated_at: "2026-11-23" }),
  ];

  it("orders failed → changed after pass → plans to close → the rest, newest first inside each", () => {
    const { active, closed } = railOrder(plans);
    expect(active.map((p) => p.plan_id)).toEqual(["old-fail", "stale", "closeA", "closeB", "new"]);
    expect(closed.map((p) => p.plan_id)).toEqual(["done"]);
    expect(railGroups(active).map((g) => [g.key, g.plans.length])).toEqual([
      ["attention", 2],
      ["closable", 2],
      ["rest", 1],
    ]);
  });

  it("draws a name and a count on each group, and no group names when nothing stands out", () => {
    const { container } = render(<PlanRail plans={plans} selectedId={null} onSelect={vi.fn()} />);
    const heads = [...container.querySelectorAll(".plv-rail-g > .plv-month-h")].map((h) => h.textContent);
    expect(heads).toEqual([`${t("plan.list.groupAttention")}2`, `${t("plan.list.groupClosable")}2`, `${t("plan.list.groupRest")}1`]);
    cleanup();
    const quiet = render(<PlanRail plans={[summary("a"), summary("b")]} selectedId={null} onSelect={vi.fn()} />);
    expect(quiet.container.querySelector(".plv-rail-g")).toBeNull();
    expect(quiet.container.querySelectorAll(".plv-li")).toHaveLength(2);
  });

  it("names the close group the way Today's number does", () => {
    expect(ko["today.nums.closable"]).toBe(`${ko["plan.list.groupClosable"]} {n}`);
    expect(en["today.nums.closable"]).toBe(`${en["plan.list.groupClosable"]} {n}`);
  });
});

describe("one count for plans to close", () => {
  it("leaves out a finished plan whose check failed — the list holds it under needs-your-eyes, so Today does not count it twice", async () => {
    const closable = (id: string, over: object = {}) => plan(id, { title: `plan ${id}`, closable: true, ...over });
    fx.digest = digest({ plans: [closable("ok"), closable("bad", { last_verdict: failed })] });
    renderToday();
    expect(await screen.findByRole("button", { name: t("today.nums.closable", { n: 1 }) })).toBeInTheDocument();
    expect(inCloseGroup({ closable: true, last_verdict: failed })).toBe(false);
    expect(inCloseGroup({ closable: true })).toBe(true);
    expect(inCloseGroup({})).toBe(false);
  });
});
