/**
 * 오늘의 「먼저 볼 것」 — 화면과 윗줄 배지가 **같은 목록**을 센다 (4.0 `{#ui-today}`).
 *
 * 재료는 따로 읽는다. 하나가 늦거나 실패해도 나머지는 선다:
 *   - 오늘 일지 + 총 일지 수   `oculpm_workday_brief([workday])`  — 일지가 바뀌면
 *   - 계획 집계              `today_digest`                      — 계획 파일이 바뀌면
 *   - 일지 없는 파일          `oculpm_compare_workday`            — 일지가 바뀌면
 *   - 일지 없이 끝난 대화      `journal_missing_signals(1일)`      — 일지가 바뀌거나 세션이 끝나면
 *   - 동료의 일지 · 이 기기에만 · 받아 온 것 (git 을 읽는다)        — 일지 · 계획이 바뀌면, 창으로 돌아오면
 *   - 플러그인 판             `claude_plugin_status`              — 처음 한 번
 *   - 바깥 터미널의 기다림 · Claude 의 질문                        — 바뀌었다는 사건이 오면
 *
 * **프로젝트마다 저장소 하나** (11-15 `{#today-store}`). 셸(배지)과 화면이 같은 값을 구독한다. 예전에는
 * 화면이 마운트마다 빈 인스턴스를 새로 만들어 탭에 올 때마다 뼈대가 섰고, 사건 하나에 같은 읽기가 두세 번
 * 돌았다. 이제는:
 *   - 사건은 붙은 인스턴스가 다 듣지만 **처음 붙은 쪽(주인)** 의 것만 읽기를 부른다.
 *   - 같은 틱에 온 요청(일지 · 계획 · 창 복귀가 한꺼번에)은 한 번으로 접는다.
 *   - 요청마다 번호를 매겨 늦게 온 옛 응답은 버린다 — 답한 질문이 다시 서지 않게.
 *   - 다시 읽다 실패하면 앞 값을 둔다(`staleSince`). 한 번도 못 읽었을 때만 오류(`error`)다.
 *   - 아무도 듣지 않다가 다시 붙으면 마지막 값으로 바로 그리고 조용히 다시 읽는다.
 *   - 창으로 돌아올 때의 다시 읽기는 `useRefetchOnWake` 의 10초 스로틀을 탄다(일지 · 계획 사건 훅에 들어 있다).
 *
 * 판정(무엇이 예외인가)은 `todayModel.buildExceptions` 가 갖는다. 일지나 계획 집계를
 * 못 읽으면 목록은 `null`(모름)이다 — 「볼 것이 없어요」라고 말하지 않는다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { claudeInstallApi, hooksApi } from "@/api/claudeSurface";
import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import type { TermInfo } from "@/api/terminal";
import { useJournalEvents, useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { useWindowTerms } from "@/features/terminal/status";
import { tError } from "@/i18n/errors";
import { createStore, type Store } from "@/lib/createStore";
import { safeUnlisten } from "@/lib/unlisten";
import type {
  Arrived,
  ClaudePluginStatus,
  ClaudeQuestion,
  ClaudeWaiting,
  JournalEntrySummary,
  JournalMissingSignal,
  LocalOnly,
  TodayDigest,
} from "@/lib/bindings";
import { buildExceptions, splitExceptions, workdayStartMs, type TodayException } from "./todayModel";

const NO_TEAM: ReadonlyMap<string, string> = new Map();

const EMPTY_DIGEST: TodayDigest = { plans: [], needs_user: [], blocked: [], journal_plan: [] };

/** 저장소가 드는 재료와 그 값의 모양. */
interface Values {
  brief: { entries: JournalEntrySummary[]; total: number };
  digest: TodayDigest;
  unrecorded: string[];
  silent: JournalMissingSignal[];
  team: ReadonlyMap<string, string>;
  local: LocalOnly | null;
  arrived: Arrived | null;
  plugin: ClaudePluginStatus | null;
  waiting: ClaudeWaiting[];
  questions: ClaudeQuestion[];
}

type Key = keyof Values;

interface Slot<T> {
  value: T | undefined;
  /** 한 번이라도 답이 왔다(값이든 실패든). 처음 읽는 중에만 `false`. */
  settled: boolean;
  /** 마지막 읽기가 실패했다면 그 이유 — 앞 값은 그대로 둔다. */
  error: string | null;
  /** 마지막으로 읽은 때(ms). */
  okAt: number | null;
}

type TodayState = { [K in Key]: Slot<Values[K]> } & {
  /** 「읽음」 을 누른 일지 → 그 표시를 지워도 되는 일지 요청 번호. 확정 전엔 `Infinity`. */
  verified: ReadonlyMap<string, number>;
};

const ALL_KEYS: readonly Key[] = ["brief", "digest", "unrecorded", "silent", "team", "local", "arrived", "plugin", "waiting", "questions"];
/** 날이 바뀌면 비우고 다시 읽는 것. */
const DAY_KEYS: readonly Key[] = ["brief", "unrecorded", "silent", "team", "arrived"];
const JOURNAL_KEYS: readonly Key[] = ["brief", "unrecorded", "silent", "team", "local", "arrived"];
const PLAN_KEYS: readonly Key[] = ["digest", "local"];
/** 「다시 시도」 — 플러그인 판은 처음 한 번이면 된다. */
const REFRESH_KEYS: readonly Key[] = ALL_KEYS.filter((k) => k !== "plugin");

const EMPTY_SLOT: Slot<never> = { value: undefined, settled: false, error: null, okAt: null };

function emptyState(): TodayState {
  const e = EMPTY_SLOT;
  return { brief: e, digest: e, unrecorded: e, silent: e, team: e, local: e, arrived: e, plugin: e, waiting: e, questions: e, verified: new Map() };
}

type Loader<T> = (projectId: number, workday: string | null) => (() => Promise<T>) | null;

/** 재료마다 읽는 법 — 날이 정해져야 읽는 것은 `null` 을 돌려준다. */
const LOADERS: { [K in Key]: Loader<Values[K]> } = {
  brief: (pid, day) =>
    day
      ? async () => {
          const res = await oculpmApi.workdayBrief(pid, [day], day);
          const bucket = (res?.days ?? []).find((d) => d.workday === day);
          return { entries: bucket?.entries ?? [], total: res?.total_entries ?? 0 };
        }
      : null,
  digest: (pid) => async () => (await planApi.todayDigest(pid)) ?? EMPTY_DIGEST,
  unrecorded: (pid, day) =>
    day
      ? async () => {
          const cmp = await oculpmApi.compareWorkday(pid, day);
          return [...new Set((cmp?.sessions ?? []).flatMap((s) => s.unrecorded))].sort();
        }
      : null,
  silent: (pid, day) =>
    day
      ? async () => {
          const rows = await hooksApi.journalMissing(pid, 1);
          const floor = workdayStartMs(day);
          return (rows ?? []).filter((s) => {
            const ms = Date.parse(s.ts);
            return !Number.isNaN(ms) && ms >= floor;
          });
        }
      : null,
  // 동료의 일지 (11-02) — `.oculpm/` 을 올리는 팀이면 pull 한 일지가 누구 것인지. 실패는 빈 표(이름만 빠진다).
  team: (pid, day) =>
    day
      ? async () => {
          const rows = await planApi.todayTeammates(pid, day).catch(() => []);
          return new Map((rows ?? []).map((r) => [r.path, r.author]));
        }
      : null,
  // 이 기기에만 있는 것 · 받아 온 것 (11-13) — 실패는 「모름」(null)이라 그 수만 안 선다.
  local: (pid) => () => planApi.todayLocalOnly(pid).catch(() => null),
  arrived: (pid, day) => (day ? () => planApi.todayArrived(pid, workdayStartMs(day)).catch(() => null) : null),
  plugin: (pid) => () => claudeInstallApi.pluginStatus(pid),
  waiting: (pid) => () => hooksApi.waiting(pid),
  questions: (pid) => async () => {
    const list = await hooksApi.questions(pid);
    return Array.isArray(list) ? list : [];
  },
};

interface Entry {
  store: Store<TodayState>;
  workday: string | null;
  /** 붙어 있는 훅 인스턴스 — 맨 앞이 사건의 주인이다. */
  holders: symbol[];
  /** 재료마다 보낸 요청 번호와, 화면에 얹은 마지막 번호. */
  sent: Record<Key, number>;
  applied: Record<Key, number>;
  pending: Set<Key>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  off: (() => void) | null;
}

const ENTRIES = new Map<number, Entry>();

function counters(): Record<Key, number> {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, 0])) as Record<Key, number>;
}

function entryOf(projectId: number): Entry {
  let e = ENTRIES.get(projectId);
  if (!e) {
    e = {
      store: createStore(emptyState()),
      workday: null,
      holders: [],
      sent: counters(),
      applied: counters(),
      pending: new Set(),
      flushTimer: null,
      off: null,
    };
    ENTRIES.set(projectId, e);
  }
  return e;
}

/** 읽기를 부른다 — 같은 틱의 요청은 다음 틱에 한 번으로 접는다(같은 사건이 일지 · 계획 훅을 함께 깨운다). */
function request(projectId: number, keys: readonly Key[]): void {
  const e = ENTRIES.get(projectId);
  if (!e) return;
  for (const k of keys) e.pending.add(k);
  if (e.flushTimer != null) return;
  e.flushTimer = setTimeout(() => {
    e.flushTimer = null;
    const due = [...e.pending];
    e.pending.clear();
    for (const k of due) load(projectId, e, k);
  }, 0);
}

function load<K extends Key>(projectId: number, e: Entry, key: K): void {
  const run = (LOADERS[key] as Loader<Values[K]>)(projectId, e.workday);
  if (!run) return;
  const n = ++e.sent[key];
  const day = e.workday;
  void Promise.resolve()
    .then(run)
    .then(
      (value) => settle(e, key, n, day, { value }),
      (err: unknown) => settle(e, key, n, day, { error: tError(toAppError(err)) || String(err) }),
    );
}

function settle<K extends Key>(e: Entry, key: K, n: number, day: string | null, out: { value: Values[K] } | { error: string }): void {
  // 늦게 온 옛 응답 — 그 뒤에 보낸 요청이 이미 답했다. 날이 바뀐 뒤에 온 어제 것도 버린다.
  if (n <= e.applied[key] || day !== e.workday) return;
  e.applied[key] = n;
  e.store.update((s) => {
    if ("error" in out) return { ...s, [key]: { ...s[key], settled: true, error: out.error } };
    const next: TodayState = { ...s, [key]: { value: out.value, settled: true, error: null, okAt: Date.now() } };
    // 「읽음」 을 확정한 뒤에 보낸 일지 읽기가 답했으면 낙관적 표시는 필요 없다 — 디스크가 답한다.
    if (key === "brief" && s.verified.size > 0) {
      next.verified = new Map([...s.verified].filter(([, since]) => n <= since));
    }
    return next;
  });
}

function setDay(projectId: number, e: Entry, workday: string | null): void {
  e.workday = workday;
  e.store.update((s) => {
    const next: TodayState = { ...s, verified: new Map() };
    for (const k of DAY_KEYS) (next as Record<Key, Slot<unknown>>)[k] = EMPTY_SLOT;
    return next;
  });
  request(projectId, DAY_KEYS);
}

/** 프로젝트 하나의 사건 — 세션 끝 · 바깥 기다림 · 질문. 붙은 인스턴스가 몇이든 한 번만 듣는다. */
function listen(projectId: number): () => void {
  let alive = true;
  const offs: Array<() => void> = [];
  const keep = (pending: Promise<() => void>) =>
    void pending
      .then((off) => {
        if (alive) offs.push(off);
        else safeUnlisten(off);
      })
      .catch(() => {});
  // 세션이 끝나면 「일지 없이 끝난 대화」가 새로 생길 수 있다.
  keep(oculpmApi.onSessionEnded((p) => p.project_id === projectId && request(projectId, ["silent"])));
  keep(hooksApi.onWaitingChanged((pid) => pid === projectId && request(projectId, ["waiting"])));
  keep(hooksApi.onQuestionsChanged((pid) => pid === projectId && request(projectId, ["questions"])));
  return () => {
    alive = false;
    offs.forEach(safeUnlisten);
  };
}

function attach(projectId: number, holder: symbol, workday: string | null): () => void {
  const e = entryOf(projectId);
  const first = e.holders.length === 0;
  e.holders.push(holder);
  if (first) e.off = listen(projectId);
  if (workday !== e.workday) setDay(projectId, e, workday);
  // 아무도 안 듣던 동안의 사건은 놓쳤다 — 앞 값으로 그린 채 조용히 다시 읽는다(처음이면 그냥 처음 읽기).
  if (first) request(projectId, ALL_KEYS);
  return () => {
    e.holders = e.holders.filter((h) => h !== holder);
    if (e.holders.length > 0) return;
    e.off?.();
    e.off = null;
  };
}

/** 사건이 부른 읽기 — 같은 사건을 인스턴스마다 듣기 때문에 주인의 것만 받는다. */
function bumpFrom(projectId: number, holder: symbol, keys: readonly Key[]): void {
  const e = ENTRIES.get(projectId);
  if (!e || e.holders[0] !== holder) return;
  request(projectId, keys);
}

/** 테스트 전용 — 모듈 저장소를 비운다(테스트 사이에 앞 테스트의 값이 남지 않게). */
export function __resetTodayStoreForTests(): void {
  for (const e of ENTRIES.values()) {
    e.off?.();
    if (e.flushTimer != null) clearTimeout(e.flushTimer);
  }
  ENTRIES.clear();
}

export interface TodayData {
  /** 오늘 일지, 최신 먼저. `undefined` = 읽는 중. */
  entries: JournalEntrySummary[] | undefined;
  /** 프로젝트 전체 일지 수 — 0 이면 「첫 기록 전」. */
  totalEntries: number | undefined;
  digest: TodayDigest | undefined;
  /** 일지 없는 파일. `null` = 모름. */
  unrecorded: string[] | null;
  silent: JournalMissingSignal[] | null;
  pluginBehind: { installed: string; bundled: string } | null;
  /** Claude Code 플러그인이 이 프로젝트에 깔려 있는가 — 첫 기록 전의 「에이전트 연결」 걸음. 모르면 `null`. */
  pluginInstalled: boolean | null;
  /** 오늘 일지 중 동료가 git 으로 더한 것 — 일지 경로 → 그 사람. 못 읽으면 빈 표. */
  teammates: ReadonlyMap<string, string>;
  /** 이 기기에만 있는 것(커밋 안 한 변경 · 안 올린 커밋). 리모트가 없거나 못 읽으면 `null`. */
  localOnly: LocalOnly | null;
  /** 오늘 받아 온 일지 · 리모트와 마지막으로 주고받은 때. 가지 위가 아니거나 못 읽으면 `null`. */
  arrived: Arrived | null;
  /** 이 창의 터미널 세션 — 「지금 일하는 중」 이 그 세션으로 보낸다. */
  terms: readonly TermInfo[];
}

export interface TodayExceptionsResult {
  data: TodayData;
  /** `null` = 아직 모름(읽는 중이거나 일지·계획 집계를 못 읽음). */
  exceptions: TodayException[] | null;
  /** 윗줄 배지 — 「먼저 볼 것」 수(`splitExceptions(...).first`), 모르면 `null`. */
  count: number | null;
  /** 일지나 계획 집계를 **한 번도** 못 읽은 이유. 앞 값이 있으면 `null` 이고 `staleSince` 가 선다. */
  error: string | null;
  /** 다시 읽다 실패했다 — 화면은 이때(ms) 읽은 값을 그대로 보여 준다. */
  staleSince: number | null;
  refresh: () => void;
  /** 「읽음」 뒤 — 확정된 일지의 낙관적 표시를 다음 일지 읽기에 맡기고 일지만 다시 읽는다. */
  reloadEntries: (confirmed?: readonly string[]) => void;
  /** 「읽음」 을 누른 직후 — 다시 읽기 전에 그 행을 뺀다. 실패하면 되돌린다. */
  markVerified: (relativePath: string, on: boolean) => void;
}

export function useTodayExceptions(
  projectId: number,
  workday: string | null,
  enabled: boolean,
): TodayExceptionsResult {
  const [holder] = useState(() => Symbol("today"));
  const entry = entryOf(projectId);
  useEffect(() => (enabled ? attach(projectId, holder, workday) : undefined), [projectId, holder, workday, enabled]);

  const onJournal = useCallback(() => bumpFrom(projectId, holder, JOURNAL_KEYS), [projectId, holder]);
  const onPlan = useCallback(() => bumpFrom(projectId, holder, PLAN_KEYS), [projectId, holder]);
  useJournalEvents(projectId, enabled, onJournal);
  useOculpmDataEvents("planner", projectId, enabled, onPlan);

  const s = entry.store.useValue();
  const terms = useWindowTerms(enabled);

  const refresh = useCallback(() => request(projectId, REFRESH_KEYS), [projectId]);
  const markVerified = useCallback(
    (path: string, on: boolean) => {
      entry.store.update((prev) => {
        const next = new Map(prev.verified);
        if (on) next.set(path, Number.POSITIVE_INFINITY);
        else next.delete(path);
        return { ...prev, verified: next };
      });
    },
    [entry],
  );
  const reloadEntries = useCallback(
    (confirmed: readonly string[] = []) => {
      // 확정 — 이 뒤에 보낸 일지 읽기가 답하면 표시를 지운다(그 전 읽기는 아직 옛 내용일 수 있다).
      const since = entry.sent.brief;
      entry.store.update((prev) => {
        if (confirmed.length === 0) return prev;
        const next = new Map(prev.verified);
        for (const p of confirmed) if (next.has(p)) next.set(p, since);
        return { ...prev, verified: next };
      });
      request(projectId, ["brief"]);
    },
    [entry, projectId],
  );

  const p = s.plugin.value;
  const pluginBehind = useMemo(
    () => (p?.behind && p.installed_version ? { installed: p.installed_version, bundled: p.bundled_version } : null),
    [p],
  );
  const verifiedLocally = useMemo(() => new Set(s.verified.keys()), [s.verified]);

  // 보조 재료 셋(일지 없는 파일·조용한 대화·플러그인)도 처음 한 번은 답을 기다린다 —
  // 안 그러면 「볼 것이 없어요」가 먼저 떴다가 행이 뒤늦게 끼어든다(배지도 같이 흔들린다).
  const sideSettled = s.unrecorded.settled && s.silent.settled && s.plugin.settled;
  const brief = s.brief.value;
  const digest = s.digest.value;
  const exceptions = useMemo(() => {
    if (!enabled || !brief || !digest || !sideSettled) return null;
    return buildExceptions({
      entries: brief.entries,
      digest,
      unrecorded: s.unrecorded.value ?? null,
      silent: s.silent.value ?? null,
      plugin: pluginBehind,
      verifiedLocally,
      terms,
      hookWaiting: s.waiting.value ?? [],
      questions: s.questions.value ?? [],
    });
  }, [enabled, brief, digest, sideSettled, s.unrecorded.value, s.silent.value, pluginBehind, verifiedLocally, terms, s.waiting.value, s.questions.value]);

  const on = enabled;
  const data: TodayData = {
    entries: on ? brief?.entries : undefined,
    totalEntries: on ? brief?.total : undefined,
    digest: on ? digest : undefined,
    unrecorded: on ? (s.unrecorded.value ?? null) : null,
    silent: on ? (s.silent.value ?? null) : null,
    pluginBehind: on ? pluginBehind : null,
    pluginInstalled: on && s.plugin.settled ? p?.installed === true : null,
    teammates: (on && s.team.value) || NO_TEAM,
    localOnly: on ? (s.local.value ?? null) : null,
    arrived: on ? (s.arrived.value ?? null) : null,
    terms,
  };

  // 한 번도 못 읽었을 때만 오류다. 앞 값이 있으면 그 값과 「언제 이후 못 읽음」 을 보여 준다.
  const error = on ? ((!brief && s.brief.error) || (!digest && s.digest.error) || null) : null;
  const failing = [s.brief, s.digest].filter((slot) => slot.value !== undefined && slot.error && slot.okAt != null);
  const staleSince = on && failing.length > 0 ? Math.min(...failing.map((slot) => slot.okAt as number)) : null;

  return {
    data,
    exceptions,
    count: exceptions ? splitExceptions(exceptions).first.length : null,
    error,
    staleSince,
    refresh,
    reloadEntries,
    markVerified,
  };
}
