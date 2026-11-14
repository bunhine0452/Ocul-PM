/**
 * 오늘 화면 시험의 공용 가짜 백엔드 (11-15) — `today_*.test.tsx` 새 파일들이 같은 모양을 쓴다.
 *
 * 쓰는 법 — 시험 파일 맨 위에:
 *   vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
 * 이 파일은 `@/lib/bindings` 의 **값**을 가져오지 않는다(타입만). 가져오면 모의 공장이 자기 자신을 기다린다.
 *
 * 픽스처 글자는 영어다 — 시험 파일의 한글 리터럴은 lint:i18n 의 허용 목록을 늘려야 한다. 화면 문장은
 * 시험이 `t()` 로 사전에서 읽는다.
 */
import type { ClaudePluginStatus, DigestPlan, JournalEntrySummary, TodayDigest } from "@/lib/bindings";

export const WORKDAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
})();

type Listener = (e: { payload: unknown }) => void;

function defaults() {
  return {
    entries: [] as JournalEntrySummary[],
    total: 10,
    digest: { plans: [], needs_user: [], blocked: [], journal_plan: [] } as TodayDigest,
    unrecorded: [] as string[],
    missing: [] as unknown[],
    plugin: { installed: true, behind: false, installed_version: "4.0.0", bundled_version: "4.0.0", path: "/p", scope: "user" } as ClaudePluginStatus | null,
    sessions: [] as unknown[],
    terms: [] as unknown[],
    hookWaiting: [] as unknown[],
    questions: [] as unknown[],
    answers: [] as Array<[string, string]>,
    verifyCalls: [] as Array<[string, boolean]>,
    bulkCalls: [] as Array<[string[], boolean]>,
    /** 「모두 읽음」 에서 못 한 것으로 돌려줄 경로. */
    bulkSkipped: [] as string[],
    dispatchCalls: [] as Array<[string, string]>,
    localOnly: null as unknown,
    arrived: null as unknown,
    /** 명령 이름(camelCase) → 부른 횟수. */
    calls: {} as Record<string, number>,
    /** 이 명령은 실패한다. */
    fail: new Set<string>(),
    /** 이 명령의 **다음 한 번** 의 답을 시험이 쥔다 — `release(name)` 로 푼다. 값은 부른 때의 것이다. */
    hold: new Set<string>(),
    held: {} as Record<string, Array<() => void>>,
    /** 사건 이름 → 구독. `emit` 이 부른다. */
    listeners: {} as Record<string, Listener[]>,
  };
}

export const fx = defaults();

export function resetFx(): void {
  Object.assign(fx, defaults());
}

/** 쥐고 있던 답 하나(가장 먼저 온 것)를 푼다. */
export function release(name: string): void {
  fx.held[name]?.shift()?.();
}

/** 백엔드 사건 — `events.<name>.listen` 으로 구독한 것들에게 보낸다. */
export function emit(name: string, payload: unknown): void {
  for (const cb of [...(fx.listeners[name] ?? [])]) cb({ payload });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function entry(i: number, over: Partial<JournalEntrySummary> = {}): JournalEntrySummary {
  const hh = String(9 + Math.floor(i / 6)).padStart(2, "0");
  const mm = String((i * 7) % 60).padStart(2, "0");
  return {
    relative_path: `${WORKDAY}/Features_to_add/${hh}${mm}_feature_e${i}.md`,
    workday: WORKDAY,
    type: "feature",
    slug: `e${i}`,
    status: "done",
    difficulty: null,
    title: `entry ${i}`,
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

export function plan(id: string, over: Partial<DigestPlan> = {}): DigestPlan {
  return {
    plan_id: id,
    title: `plan ${id}`,
    progress: 0.5,
    done_count: 2,
    item_count: 4,
    closable: false,
    updated_at: "2026-11-14",
    done_when: "done",
    check: "pnpm test",
    last_verdict: null,
    stale_files: [],
    next: null,
    ...over,
  };
}

export function digest(over: Partial<TodayDigest> = {}): TodayDigest {
  return { plans: [], needs_user: [], blocked: [], journal_plan: [], ...over };
}

/** 검증 명령을 받은 일지는 디스크에서도 그렇게 된다 — 다시 읽은 목록이 그 사실을 말하게. */
function markOnDisk(paths: readonly string[], on: boolean): void {
  fx.entries = fx.entries.map((e) => (paths.includes(e.relative_path) ? { ...e, verified_by_user: on, verified_stale: false } : e));
}

export function bindingsMock() {
  /** 부른 때의 값으로 답한다. `hold` 에 있으면 시험이 풀 때까지 쥔다. */
  const respond = (name: string, compute: () => unknown, envelope = true): Promise<unknown> => {
    fx.calls[name] = (fx.calls[name] ?? 0) + 1;
    const failing = fx.fail.has(name);
    const value = failing ? undefined : compute();
    const out = () => (failing ? Promise.reject(new Error(`${name} failed`)) : Promise.resolve(envelope ? { status: "ok", data: value } : value));
    if (!fx.hold.has(name)) return out();
    fx.hold.delete(name);
    return new Promise((resolve, reject) => {
      (fx.held[name] ??= []).push(() => void out().then(resolve, reject));
    });
  };
  const commands = new Proxy(
    {},
    {
      get: (_t, prop) => {
        const name = String(prop);
        switch (name) {
          case "oculpmWorkdayBrief":
            return (_p: number, workdays: string[]) =>
              respond(name, () => ({
                days: workdays.map((wd) => ({ workday: wd, entries: fx.entries })),
                lines_added: 0,
                lines_removed: 0,
                files_touched: 0,
                open_plan_items: [],
                total_entries: fx.total,
              }));
          case "todayDigest":
            return () => respond(name, () => fx.digest);
          case "todayTeammates":
            return () => respond(name, () => []);
          case "todayLocalOnly":
            return () => respond(name, () => fx.localOnly);
          case "todayArrived":
            return () => respond(name, () => fx.arrived);
          case "oculpmCompareWorkday":
            return () =>
              respond(name, () => ({
                workday: WORKDAY,
                sessions: [{ session_id: `${WORKDAY}-001`, unrecorded: fx.unrecorded, unrecorded_severity: "warning" }],
                unrecorded_total: fx.unrecorded.length,
              }));
          case "journalMissingSignals":
            return () => respond(name, () => fx.missing);
          case "claudePluginStatus":
            return () => respond(name, () => fx.plugin);
          case "oculpmListSessions":
            return () => respond(name, () => fx.sessions);
          case "oculpmSetJournalVerified":
            return (_p: number, path: string, on: boolean) =>
              respond(name, () => {
                fx.verifyCalls.push([path, on]);
                markOnDisk([path], on);
                return null;
              });
          case "oculpmSetJournalVerifiedBulk":
            return (_p: number, paths: string[], on: boolean) =>
              respond(name, () => {
                fx.bulkCalls.push([paths, on]);
                const skipped = paths.filter((p) => fx.bulkSkipped.includes(p));
                markOnDisk(
                  paths.filter((p) => !skipped.includes(p)),
                  on,
                );
                return { updated: paths.length - skipped.length, skipped: skipped.map((path) => ({ path, reason: "locked" })) };
              });
          case "planDispatchPrompt":
            return (_p: number, planId: string, itemId: string) =>
              respond(name, () => {
                fx.dispatchCalls.push([planId, itemId]);
                return { file_rel: "x", command: "x", prompt: "PROMPT", item_title: "next item" };
              });
          case "settingsGetAll":
            return () => respond(name, () => [] as Array<[string, string]>);
          // 봉투 없는 명령 — 이 창의 터미널 세션 · 바깥 터미널의 기다림.
          case "termList":
            return () => respond(name, () => fx.terms, false);
          case "claudeWaiting":
            return () => respond(name, () => fx.hookWaiting, false);
          case "claudeWaitingDismiss":
            return () => respond(name, () => null, false);
          case "claudeQuestions":
            return () => respond(name, () => fx.questions);
          case "claudeQuestionAnswer":
            return (_p: number, id: string, answer: string) =>
              respond(name, () => {
                fx.answers.push([id, answer]);
                return null;
              });
          default:
            return () => respond(name, () => null);
        }
      },
    },
  );
  const events = new Proxy(
    {},
    {
      get: (_t, prop) => ({
        listen: (cb: Listener) => {
          const name = String(prop);
          (fx.listeners[name] ??= []).push(cb);
          return Promise.resolve(() => {
            fx.listeners[name] = (fx.listeners[name] ?? []).filter((x) => x !== cb);
          });
        },
      }),
    },
  );
  return { commands, events };
}
