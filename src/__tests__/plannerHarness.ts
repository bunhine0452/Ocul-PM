/**
 * 계획 화면 시험의 공용 가짜 백엔드 (11-15) — `plan_verdict_v2` · `planner_keyboard` · `stale_state` ·
 * `journal_planner_copy` 가 같이 쓴다. 팩토리 안에서 동적으로 불러 쓴다(`journalHarness` 와 같은 이유).
 */
import type { PlanDetail, PlanItemDto, PlanSummary, PlanVerdict } from "@/lib/bindings";

export function plan(id: string, over: Partial<PlanSummary> = {}): PlanSummary {
  return {
    plan_id: id,
    title: `Plan ${id}`,
    status: "active",
    owner_agent: "claude-code",
    progress: 0.5,
    file_path: `.oculpm/planner/${id}.md`,
    updated_at: "2026-11-01",
    item_count: 2,
    done_count: 1,
    last_verdict: null,
    ...over,
  };
}

export function item(id: string, status: string, order: number, over: Partial<PlanItemDto> = {}): PlanItemDto {
  return {
    item_id: id,
    phase: "Phase",
    title: `Item ${id}`,
    status,
    order_idx: order,
    parent_item: null,
    note: null,
    last_agent: null,
    last_update: null,
    journal_refs: [],
    ...over,
  };
}

export function detail(p: PlanSummary, items: PlanItemDto[], over: Partial<PlanDetail> = {}): PlanDetail {
  return { plan: p, items, phases: [], decisions: [], warnings: [], done_when: "it is done", check: "pnpm test", ...over };
}

export function verdict(over: Partial<PlanVerdict> = {}): PlanVerdict {
  return { passed: true, summary: "12 passed", ts: new Date().toISOString(), agent_id: "claude-code", item_id: "x", ...over };
}

export const pfx = {
  plans: [] as PlanSummary[],
  details: {} as Record<string, PlanDetail>,
  edits: [] as Array<{ planId: string; op: unknown }>,
  dispatch: [] as Array<[string, string]>,
  runs: [] as string[],
  logCalls: 0,
  logRows: [] as unknown[],
  /** 다음 `planList` 를 실패시킨다(한 번). */
  failList: 0,
  /** 다음 `planGet` 을 실패시킨다(한 번). */
  failGet: 0,
  /** 이 계획의 `planGet` 은 시험이 풀 때까지 붙잡는다. */
  hold: new Set<string>(),
  held: [] as Array<() => void>,
};

export function resetPlanFixtures() {
  pfx.plans = [];
  pfx.details = {};
  pfx.edits = [];
  pfx.dispatch = [];
  pfx.runs = [];
  pfx.logCalls = 0;
  pfx.logRows = [];
  pfx.failList = 0;
  pfx.failGet = 0;
  pfx.hold = new Set();
  pfx.held = [];
}

export function stage(details: PlanDetail[], plans?: PlanSummary[]) {
  pfx.details = Object.fromEntries(details.map((d) => [d.plan.plan_id, d]));
  pfx.plans = plans ?? details.map((d) => d.plan);
}

/** 워처 이벤트 버스 (채널명 → 리스너). */
export const pbus: Record<string, Array<(e: { payload: unknown }) => void>> = {};
export function pemit(channel: string, payload: unknown) {
  for (const cb of pbus[channel] ?? []) cb({ payload });
}

export function plannerBindings() {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const err = () => Promise.resolve({ status: "error" as const, error: { code: "io", message: "boom" } });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "planList":
              return () => {
                if (pfx.failList > 0) {
                  pfx.failList -= 1;
                  return err();
                }
                return ok(pfx.plans);
              };
            case "planGet":
              return (_p: number, id: string) => {
                if (pfx.failGet > 0) {
                  pfx.failGet -= 1;
                  return err();
                }
                if (pfx.hold.has(id)) return new Promise((resolve) => pfx.held.push(() => resolve({ status: "ok", data: pfx.details[id] ?? null })));
                return ok(pfx.details[id] ?? null);
              };
            case "planApplyEdit":
              // 상태 바꾸기는 디스크(가짜)에도 남긴다 — 응답이 옛 문서로 화면을 되돌리지 않게.
              return (_p: number, planId: string, op: { kind: string; item_id?: string; status?: string }) => {
                pfx.edits.push({ planId, op });
                const d = pfx.details[planId];
                if (d && op.kind === "set_status") {
                  pfx.details[planId] = { ...d, items: d.items.map((i) => (i.item_id === op.item_id ? { ...i, status: op.status ?? i.status } : i)) };
                }
                return ok(pfx.details[planId]);
              };
            case "planLog":
              return () => {
                pfx.logCalls += 1;
                return ok(pfx.logRows);
              };
            case "planLockedOpen":
              return () => ok([]);
            case "planDispatchPrompt":
              return (_p: number, planId: string, itemId: string) => {
                pfx.dispatch.push([planId, itemId]);
                return ok({ file_rel: "x", command: "x", prompt: "PROMPT", item_title: itemId });
              };
            case "settingsGetAll":
              return () => ok([] as Array<[string, string]>);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy(
      {},
      {
        get: (_t, name: string) => ({
          listen: (cb: (e: { payload: unknown }) => void) => {
            (pbus[name] ??= []).push(cb);
            return Promise.resolve(() => {
              pbus[name] = (pbus[name] ?? []).filter((f) => f !== cb);
            });
          },
        }),
      },
    ),
  };
}

export function runPromptModule() {
  return {
    runPromptInTerminal: async (_projectId: number, prompt: string) => {
      pfx.runs.push(prompt);
    },
    runGoalInTerminal: async (_projectId: number, goal: string) => {
      pfx.runs.push(goal);
      return true;
    },
  };
}
