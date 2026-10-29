/**
 * 오늘의 「확인할 것」 — 화면과 사이드바 배지가 **같은 목록**을 센다 (4.0 `{#ui-today}`).
 *
 * 재료 다섯을 따로 읽는다. 하나가 늦거나 실패해도 나머지는 선다:
 *   - 오늘 일지 + 총 일지 수   `oculpm_workday_brief([workday])`  — 일지가 바뀌면
 *   - 계획 집계              `today_digest`                      — 계획 파일이 바뀌면
 *   - 기록 없는 파일          `oculpm_compare_workday`            — 일지가 바뀌면
 *   - 일지 없이 끝난 대화      `journal_missing_signals(1일)`      — 일지·세션 종료
 *   - 플러그인 판             `claude_plugin_status`              — 마운트에 한 번
 *
 * 판정(무엇이 예외인가)은 `todayModel.buildExceptions` 가 갖는다. 일지나 계획 집계를
 * 못 읽으면 목록은 `null`(모름)이다 — 「볼 것이 없어요」라고 말하지 않는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { claudeInstallApi, hooksApi } from "@/api/claudeSurface";
import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import { useJournalEvents, useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { tError } from "@/i18n/errors";
import { safeUnlisten } from "@/lib/unlisten";
import type { JournalEntrySummary, JournalMissingSignal, TodayDigest } from "@/lib/bindings";
import { buildExceptions, splitExceptions, workdayStartMs, type TodayException } from "./todayModel";

interface Loaded<T> {
  value: T | undefined;
  error: string | null;
  /** 한 번이라도 답이 왔다 (값이든 실패든). 처음 읽는 중에만 `false`. */
  settled: boolean;
}

/** `key` 가 바뀔 때마다 다시 읽는다. 다시 읽는 동안에는 앞 값을 그대로 둔다 (깜빡임 없음). */
function useLoad<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<Loaded<T>>({ value: undefined, error: null, settled: false });
  useEffect(() => {
    if (key == null) {
      setState({ value: undefined, error: null, settled: false });
      return;
    }
    let alive = true;
    void Promise.resolve()
      .then(() => loadRef.current())
      .then(
        (value) => {
          if (alive) setState({ value, error: null, settled: true });
        },
        (e: unknown) => {
          if (alive) setState({ value: undefined, error: tError(toAppError(e)) || String(e), settled: true });
        },
      );
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}

const EMPTY_DIGEST: TodayDigest = { plans: [], needs_user: [], blocked: [], journal_plan: [] };

export interface TodayData {
  /** 오늘 일지, 최신 먼저. `undefined` = 읽는 중. */
  entries: JournalEntrySummary[] | undefined;
  /** 프로젝트 전체 일지 수 — 0 이면 「첫 기록 전」. */
  totalEntries: number | undefined;
  digest: TodayDigest | undefined;
  /** 기록 없는 파일. `null` = 모름. */
  unrecorded: string[] | null;
  silent: JournalMissingSignal[] | null;
  pluginBehind: { installed: string; bundled: string } | null;
}

export interface TodayExceptionsResult {
  data: TodayData;
  /** `null` = 아직 모름(읽는 중이거나 일지·계획 집계를 못 읽음). */
  exceptions: TodayException[] | null;
  /** 윗줄 배지 — 「먼저 볼 것」 수(`splitExceptions(...).first`), 모르면 `null`. */
  count: number | null;
  /** 일지나 계획 집계를 못 읽은 이유. */
  error: string | null;
  refresh: () => void;
  /** 「확인함」을 누른 직후 — 다시 읽기 전에 그 행을 뺀다. 실패하면 되돌린다. */
  markVerified: (relativePath: string, on: boolean) => void;
}

export function useTodayExceptions(
  projectId: number,
  workday: string | null,
  enabled: boolean,
): TodayExceptionsResult {
  const [journalTick, setJournalTick] = useState(0);
  const [planTick, setPlanTick] = useState(0);
  const [manualTick, setManualTick] = useState(0);
  const bumpJournal = useCallback(() => setJournalTick((n) => n + 1), []);
  const bumpPlan = useCallback(() => setPlanTick((n) => n + 1), []);
  const refresh = useCallback(() => setManualTick((n) => n + 1), []);
  useJournalEvents(projectId, enabled, bumpJournal);
  useOculpmDataEvents("planner", projectId, enabled, bumpPlan);

  // 세션이 끝나면 「일지 없이 끝난 대화」가 새로 생길 수 있다.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let off: (() => void) | null = null;
    void oculpmApi
      .onSessionEnded((p) => {
        if (p.project_id === projectId) bumpJournal();
      })
      .then((u) => {
        if (alive) off = u;
        else safeUnlisten(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
      safeUnlisten(off);
    };
  }, [projectId, enabled, bumpJournal]);

  const dayKey = enabled && workday ? `${projectId}|${workday}|${journalTick}|${manualTick}` : null;

  const brief = useLoad(dayKey, async () => {
    const res = await oculpmApi.workdayBrief(projectId, [workday!], workday);
    const bucket = (res?.days ?? []).find((d) => d.workday === workday);
    return { entries: bucket?.entries ?? [], total: res?.total_entries ?? 0 };
  });

  const digest = useLoad(enabled ? `${projectId}|${planTick}|${manualTick}` : null, async () => {
    const d = await planApi.todayDigest(projectId);
    return d ?? EMPTY_DIGEST;
  });

  const unrecorded = useLoad(dayKey, async () => {
    const cmp = await oculpmApi.compareWorkday(projectId, workday!);
    return [...new Set((cmp?.sessions ?? []).flatMap((s) => s.unrecorded))].sort();
  });

  const silent = useLoad(dayKey, async () => {
    const rows = await hooksApi.journalMissing(projectId, 1);
    const floor = workdayStartMs(workday!);
    return (rows ?? []).filter((s) => {
      const ms = Date.parse(s.ts);
      return !Number.isNaN(ms) && ms >= floor;
    });
  });

  const plugin = useLoad(enabled ? String(projectId) : null, () => claudeInstallApi.pluginStatus(projectId));

  const [verifiedLocally, setVerifiedLocally] = useState<ReadonlySet<string>>(new Set());
  // 다시 읽은 목록이 도착하면 낙관적 표시는 필요 없다 — 디스크가 답한다.
  useEffect(() => setVerifiedLocally(new Set()), [brief.value]);
  const markVerified = useCallback((path: string, on: boolean) => {
    setVerifiedLocally((prev) => {
      const next = new Set(prev);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const p = plugin.value;
  const pluginBehind = useMemo(
    () => (p?.behind && p.installed_version ? { installed: p.installed_version, bundled: p.bundled_version } : null),
    [p],
  );

  const data: TodayData = {
    entries: brief.value?.entries,
    totalEntries: brief.value?.total,
    digest: digest.value,
    unrecorded: unrecorded.value ?? null,
    silent: silent.value ?? null,
    pluginBehind,
  };

  // 보조 재료 셋(기록 없는 파일·조용한 대화·플러그인)도 처음 한 번은 답을 기다린다 —
  // 안 그러면 「볼 것이 없어요」가 먼저 떴다가 행이 뒤늦게 끼어든다(배지도 같이 흔들린다).
  const sideSettled = unrecorded.settled && silent.settled && plugin.settled;
  const exceptions = useMemo(() => {
    if (!brief.value || !digest.value || !sideSettled) return null;
    return buildExceptions({
      entries: brief.value.entries,
      digest: digest.value,
      unrecorded: unrecorded.value ?? null,
      silent: silent.value ?? null,
      plugin: pluginBehind,
      verifiedLocally,
    });
  }, [brief.value, digest.value, sideSettled, unrecorded.value, silent.value, pluginBehind, verifiedLocally]);

  return {
    data,
    exceptions,
    count: exceptions ? splitExceptions(exceptions).first.length : null,
    error: brief.error ?? digest.error,
    refresh,
    markVerified,
  };
}
