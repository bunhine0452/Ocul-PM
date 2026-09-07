import { useCallback, useEffect, useMemo, useState } from "react";
import { commands, type EntryType, type JournalEntrySummary } from "@/lib/bindings";
import { useJournalEvents, useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { getLang } from "@/i18n";
import { shiftWorkday } from "@/lib/workday";
import { tError } from "@/i18n/errors";

// Final UI Update (ui_v2) — Today 6-block dashboard data.
//
// v2 U12 (N3): 이전엔 요일당 list 7회 + 오늘 엔트리당 get 1회(증감 합산용)로
// Today 오픈이 7+N 회 IPC 를 유발했다. 이제 단일 `oculpm_workday_brief` 가
// 7일 버킷 + 오늘 라인 증감 합(SQL SUM) + 미완 플랜 항목("다음 할 일") + 총 일지
// 수를 한 번에 내려준다 — 집계는 계속 프런트에서 (주간 차트/하이라이트 랭킹).
//
// v3-release {#distinct-files-backend}: 「변경된 파일」의 고유 개수도 이제 같은
// 브리프가 `COUNT(DISTINCT file_path)` 로 답한다. 여기서 상세를 N회 걷어 경로
// 합집합을 만들던 코드와 그 캐시는 지웠다 — 둘을 다 남기면 정본이 둘이 된다.

export interface AgentContribution {
  id: string;
  count: number;
}

export interface WeekBar {
  /** YYYYMMDD */
  workday: string;
  /** Short weekday label, e.g. "월". */
  label: string;
  count: number;
  isToday: boolean;
}

/** Today "다음 할 일" 행 (v2 U12 — brief 의 open_plan_items 에서 파생). */
export interface NextTask {
  /** Stable React key: `<plan_id>:<item_id>` (item ids only unique per plan). */
  id: string;
  title: string;
  /** The item's phase, else its plan title — context for the row. */
  goalTitle: string;
  /** Item is in progress (drives the spinner + 진행중 pill). */
  active: boolean;
}

export interface TodayBrief {
  /** All of today's entries, newest first (as returned by the backend). */
  today: JournalEntrySummary[];
  /** Yesterday's `done` entries, newest first. */
  yesterdayDone: JournalEntrySummary[];
  changedToday: number;
  /**
   * 오늘 만진 **고유** 파일 수 — 백엔드의 `COUNT(DISTINCT file_path)` 그대로
   * (v3-release `{#distinct-files-backend}`).
   *
   * 터치 횟수가 아니다: `Σ files_count` 를 세면 같은 파일을 두 일지가 건드릴 때
   * 둘로 세어 이 저장소 실측으로 최대 105% 부풀었다. 한동안은 프런트가 오늘
   * 엔트리 상세를 N회 걷어 경로 합집합을 만들고 `경로|갱신시각` 으로 캐시했는데,
   * 합집합은 SQL 이 이미 아는 것이라 걷기와 캐시를 통째로 지웠다.
   */
  filesTouched: number;
  /** Σ lines added across today's entries, counted from the diff sidecars. */
  linesAdded: number;
  linesRemoved: number;
  /** Count of today's `error` (에러 사이클) entries. */
  errorCycles: number;
  agents: AgentContribution[];
  /** 7-day rolling change counts, oldest → newest (today last). */
  week: WeekBar[];
  /** Top-3 highlight entries (error first, then most files touched). */
  highlights: JournalEntrySummary[];
  /** 활성 플랜의 미완 항목 상위 5 (진행중 우선) — "다음 할 일" 위젯. */
  nextTasks: NextTask[];
  /** 프로젝트 전체 일지 수 (모니터 행의 365-히트맵 축약을 대체). */
  totalEntries: number;
}

/**
 * 요일 라벨 — 하드코딩 배열 대신 `Intl` 로 뽑는다. 사전에 7개 키를 넣는 것보다
 * 정확하고(로케일별 축약 규칙을 브라우저가 안다) 언어를 늘려도 손댈 게 없다.
 * 인덱스는 `Date.getDay()` 와 같은 일요일=0 기준.
 */
function weekdayLabels(lang: string): string[] {
  const fmt = new Intl.DateTimeFormat(lang, { weekday: "short" });
  // 1970-01-04 는 일요일 — 거기서 7일을 돌린다.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(1970, 0, 4 + i))));
}
const MAX_NEXT_TASKS = 5;
/** 어제 마무리한 작업 표시 상한 — 왼쪽 열이 오른쪽(다음 할 일 5줄)과 비슷한
 *  분량을 갖도록 "다음 할 일"과 같은 5로 맞춘다. */
const MAX_YESTERDAY_DONE = 5;

/** Shift a YYYYMMDD key by `delta` calendar days (local time). */

function weekdayLabel(workday: string): string {
  const y = Number(workday.slice(0, 4));
  const m = Number(workday.slice(4, 6)) - 1;
  const d = Number(workday.slice(6, 8));
  return weekdayLabels(getLang())[new Date(y, m, d).getDay()] ?? "";
}

/** Highlight ranking: error cycles first, then most files touched. */
function rankHighlights(entries: JournalEntrySummary[]): JournalEntrySummary[] {
  return [...entries]
    .sort((a, b) => {
      const ae = a.type === ("error" satisfies EntryType) ? 1 : 0;
      const be = b.type === ("error" satisfies EntryType) ? 1 : 0;
      if (ae !== be) return be - ae;
      return b.files_count - a.files_count;
    })
    .slice(0, 3);
}

interface UseTodayBriefResult {
  brief: TodayBrief | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Build the Today brief for `workday` (the current workday key). Returns null
 * until the first fetch resolves. Re-runs on `refreshTick` change.
 */
export function useTodayBrief(
  projectId: number | null,
  workday: string | null,
  enabled: boolean,
): UseTodayBriefResult {
  const [brief, setBrief] = useState<TodayBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Live refresh when the watcher indexes a journal change for this project
  // (PR-UI 8b follow-up — Today reflects new entries without a remount).
  useJournalEvents(projectId, enabled, refresh);
  // brief 는 `open_plan_items` 도 담는다 — "다음 할 일" 이 에이전트가 항목을
  // 닫은 뒤에도 그대로 남아 있으면 안 된다.
  useOculpmDataEvents("planner", projectId, enabled, refresh);

  // The 7 workday keys we chart, oldest → newest.
  const weekKeys = useMemo(() => {
    if (!workday) return [];
    return Array.from({ length: 7 }, (_, i) => shiftWorkday(workday, i - 6));
  }, [workday]);

  useEffect(() => {
    if (!enabled || projectId == null || !workday) {
      setBrief(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // v2 U12 — 단일 IPC. 이전: list×7 + getEntry×N.
        const res = await commands.oculpmWorkdayBrief(projectId, weekKeys, workday);
        if (cancelled) return;
        if (res.status !== "ok") {
          setError(tError(res.error));
          setBrief(null);
          return;
        }
        const byKey = new Map<string, JournalEntrySummary[]>();
        for (const bucket of res.data.days) byKey.set(bucket.workday, bucket.entries);

        const today = byKey.get(workday) ?? [];
        const yesterdayKey = shiftWorkday(workday, -1);
        const yesterdayDone = (byKey.get(yesterdayKey) ?? []).filter(
          (e) => e.status === "done",
        );

        const week: WeekBar[] = weekKeys.map((wd) => ({
          workday: wd,
          label: weekdayLabel(wd),
          count: (byKey.get(wd) ?? []).length,
          isToday: wd === workday,
        }));

        const agentCounts = new Map<string, number>();
        for (const e of today) {
          agentCounts.set(e.agent_id, (agentCounts.get(e.agent_id) ?? 0) + 1);
        }
        const agents: AgentContribution[] = [...agentCounts.entries()]
          .map(([id, count]) => ({ id, count }))
          .sort((a, b) => b.count - a.count);

        const errorCycles = today.filter((e) => e.type === "error").length;
        const highlights = rankHighlights(today);

        // 백엔드가 이미 진행중 우선으로 정렬해서 내려준다.
        const nextTasks: NextTask[] = res.data.open_plan_items
          .slice(0, MAX_NEXT_TASKS)
          .map((it) => ({
            id: `${it.plan_id}:${it.item_id}`,
            title: it.item_title,
            goalTitle: it.phase ?? it.plan_title,
            active: it.status === "in_progress",
          }));

        setBrief({
          today,
          yesterdayDone: yesterdayDone.slice(0, MAX_YESTERDAY_DONE),
          changedToday: today.length,
          filesTouched: res.data.files_touched,
          linesAdded: res.data.lines_added,
          linesRemoved: res.data.lines_removed,
          errorCycles,
          agents,
          week,
          highlights,
          nextTasks,
          totalEntries: res.data.total_entries,
        });
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        setBrief(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, workday, enabled, weekKeys, tick]);

  return { brief, loading, error, refresh };
}
