/**
 * 일지 화면 시험의 공용 가짜 백엔드 (11-15) — `journal_keyboard` · `journal_list_v2` · `stale_state` 가 같이 쓴다.
 *
 * vi.mock 팩토리는 끌어올려지므로 바깥 변수를 못 본다 — 각 시험은 팩토리 안에서 이 모듈을 동적으로
 * 불러 쓴다(`vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule())`).
 * 같은 시험 파일 안에서는 모듈 하나라 `jfx` 가 시험과 가짜 백엔드 사이의 공유 상태다.
 */
import type { JournalEntrySummary, WorkdayBrief } from "@/lib/bindings";

export function entry(over: Partial<JournalEntrySummary> = {}): JournalEntrySummary {
  return {
    relative_path: "20260531/Features_to_add/1000_feature_x.md",
    workday: "20260531",
    type: "feature",
    slug: "x",
    status: "done",
    difficulty: null,
    title: "Sample work",
    checkbox: null,
    session_id: "20260531-001",
    agent_id: "claude-code",
    agent_version: null,
    verified_by_user: false,
    verified_stale: false,
    evidence: 2,
    created_at: "2026-05-31T10:00:00+09:00",
    updated_at: null,
    tags: [],
    files_count: 1,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

interface Hit {
  relative_path: string;
  workday: string;
  snippet?: string;
  matched_field?: string;
  why?: string;
}

export const jfx = {
  byWorkday: {} as Record<string, JournalEntrySummary[]>,
  allPeriod: [] as JournalEntrySummary[],
  hits: [] as Hit[],
  hitsTotal: null as number | null,
  gone: [] as string[],
  /** 경로 → 본문 (없으면 기본 본문). */
  bodies: {} as Record<string, string>,
  /** 읽음 응답을 붙잡아 두고 싶을 때 — 시험이 직접 푼다. */
  holdVerify: false,
  held: [] as Array<() => void>,
  verified: [] as Array<{ relativePath: string; verified: boolean }>,
  searches: [] as string[],
  diffs: [] as Array<{ path: string; patch: string }>,
  related: [] as Array<{ relative_path: string; title: string; score: number; reasons: Array<{ code: string; params: string[] }> }>,
  /** 일지에 적힌 `related` 링크 (경로 → 참조들). */
  explicit: {} as Record<string, Array<{ ref: string; kind: string }>>,
  /** 읽지 못하는 일지 경로 — `getJournalEntry` 가 null. */
  missing: new Set<string>(),
  created: [] as Array<{ title: string }>,
};

export function resetJournalFixtures() {
  jfx.byWorkday = {};
  jfx.allPeriod = [];
  jfx.hits = [];
  jfx.hitsTotal = null;
  jfx.gone = [];
  jfx.bodies = {};
  jfx.holdVerify = false;
  jfx.held = [];
  jfx.verified = [];
  jfx.searches = [];
  jfx.diffs = [];
  jfx.related = [];
  jfx.explicit = {};
  jfx.missing = new Set();
  jfx.created = [];
}

const all = () => [...Object.values(jfx.byWorkday).flat(), ...jfx.allPeriod];

/** 워처 이벤트를 시험이 직접 쏘는 버스 (채널명 → 리스너). */
export const bus: Record<string, Array<(e: { payload: unknown }) => void>> = {};
export function emit(channel: string, payload: unknown) {
  for (const cb of bus[channel] ?? []) cb({ payload });
}

export function oculpmModule() {
  class MockOculpmApiError extends Error {}
  return {
    OculpmApiError: MockOculpmApiError,
    oculpmApi: {
      listJournalEntries: (_pid: number, workday?: string) =>
        Promise.resolve(workday ? (jfx.byWorkday[workday] ?? []) : jfx.allPeriod),
      listJournalEntriesPage: (_pid: number, _wd: string | undefined, filters: { types?: string[] } | undefined, limit: number) => {
        const types = filters?.types ?? [];
        const rows = jfx.allPeriod.filter((e) => types.length === 0 || types.includes(e.type));
        return Promise.resolve({ entries: rows.slice(0, limit), total: rows.length });
      },
      searchJournal: (_pid: number, query: string) => {
        jfx.searches.push(query);
        return Promise.resolve({
          hits: jfx.hits.map((h) => ({
            entry_type: "feature",
            status: "done",
            title: all().find((e) => e.relative_path === h.relative_path)?.title ?? "",
            snippet: h.snippet ?? "",
            matched_field: h.matched_field ?? "body",
            why: h.why ?? "",
            score: 1,
            ...h,
          })),
          total: jfx.hitsTotal ?? jfx.hits.length,
        });
      },
      workdayEntries: (_pid: number, workdays: string[]) => Promise.resolve(all().filter((e) => workdays.includes(e.workday))),
      getJournalEntry: (_pid: number, relativePath: string) => {
        if (jfx.missing.has(relativePath)) return Promise.resolve(null);
        const e = all().find((x) => x.relative_path === relativePath);
        const title = e?.title ?? "Title";
        return Promise.resolve({
          relative_path: relativePath,
          title,
          body_markdown: jfx.bodies[relativePath] ?? `[x] ${title}\n\n## Flow\nbody of ${title}\n\n## Verification\n- \`pnpm test\` → 3 passed\n`,
          evidence: e?.evidence ?? 2,
          mtime: "2026-05-31T12:00:00+09:00",
          parse_ok: e?.parse_ok ?? true,
          parse_warnings: e?.parse_warnings ?? [],
          frontmatter: { files_touched: [], related: jfx.explicit[relativePath] ?? [], agent: { id: "claude-code", version: null } },
        });
      },
      getEntryDiffs: () => Promise.resolve(jfx.diffs),
      suggestRelated: () => Promise.resolve(jfx.related),
      getFileChanges: () => Promise.resolve([]),
      goneJournals: () => Promise.resolve(jfx.gone),
      openEntryInEditor: () => Promise.resolve(null),
      backfillFromGit: () => Promise.resolve({ created: 0, scanned: 0 }),
      createManualEntry: (_pid: number, draft: { title: string }) => {
        jfx.created.push(draft);
        return Promise.resolve({ relative_path: "x", title: draft.title });
      },
      setJournalVerified: (_pid: number, relativePath: string, verified: boolean) => {
        jfx.verified.push({ relativePath, verified });
        if (!jfx.holdVerify) return Promise.resolve(null);
        return new Promise((resolve) => jfx.held.push(() => resolve(null)));
      },
    },
  };
}

export function planModule() {
  return { planApi: { journalLinks: () => Promise.resolve([]) } };
}

/** 14일 창은 단일 brief 명령 — 나머지 bindings 표면(타입 · 이벤트)은 가짜 버스로. */
export function bindingsModule(orig: typeof import("@/lib/bindings")) {
  return {
    ...orig,
    commands: {
      ...orig.commands,
      oculpmWorkdayBrief: (_pid: number, workdays: string[]) =>
        Promise.resolve({
          status: "ok" as const,
          data: {
            days: workdays.map((wd) => ({ workday: wd, entries: jfx.byWorkday[wd] ?? [] })) as unknown as WorkdayBrief["days"],
            lines_added: 0,
            lines_removed: 0,
            files_touched: 0,
            open_plan_items: [] as WorkdayBrief["open_plan_items"],
            total_entries: 0,
          } satisfies WorkdayBrief,
        }),
    },
    events: new Proxy(
      {},
      {
        get: (_t, name: string) => ({
          listen: (cb: (e: { payload: unknown }) => void) => {
            (bus[name] ??= []).push(cb);
            return Promise.resolve(() => {
              bus[name] = (bus[name] ?? []).filter((f) => f !== cb);
            });
          },
        }),
      },
    ),
  };
}
