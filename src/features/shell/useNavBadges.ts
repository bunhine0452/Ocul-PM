/**
 * 사이드바 행 옆의 수 — 「예외만 보여 준다」(4.0).
 *
 * 둘 뿐이다: **확인할 것**(경고색 — 오늘·변경 행)과 **오늘 기록 수**(조용한 색 — 작업
 * 일지 행). 변경 행의 수는 「오늘 에이전트가 고치고 일지에 안 적은 파일 수」
 * (`compare_workday` 의 미기록)다. 오늘 행은 오늘 화면의 예외 목록 길이를
 * `todayToCheck` 로 받는다(`useTodayExceptions(...).count`) — 안 주면(`undefined`)
 * 미기록 파일 수로 대신한다. `null` 은 「모름」이라 배지가 없다.
 *
 * 워처 이벤트(파일 변경·새 일지)를 1초로 묶어 다시 센다. 못 읽은 칸은 `null` =
 * 배지 없음(0 과 다르다).
 */
import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { projectsApi } from "@/api/projects";
import type { UiV2View } from "@/contexts/WorkspaceContext";

export type NavBadgeTone = "warn" | "dim";
export type NavBadges = Partial<Record<UiV2View, { n: number; tone: NavBadgeTone }>>;

const SETTLE_MS = 1000;

interface Counts {
  unrecorded: number | null;
  todayEntries: number | null;
}

export function useNavBadges(
  projectId: number | null,
  workday: string | null,
  ready: boolean,
  todayToCheck?: number | null,
): NavBadges {
  const [counts, setCounts] = useState<Counts>({ unrecorded: null, todayEntries: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (projectId == null || !ready) return;
    let timer: number | null = null;
    const bump = (pid: number) => {
      if (pid !== projectId) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setTick((n) => n + 1), SETTLE_MS);
    };
    const offs = [
      oculpmApi.onFileChanged((p) => bump(p.project_id)),
      projectsApi.onJournalAdded(bump),
    ];
    return () => {
      if (timer != null) window.clearTimeout(timer);
      for (const off of offs) void off.then((fn) => fn());
    };
  }, [projectId, ready]);

  useEffect(() => {
    if (projectId == null || !workday || !ready) {
      setCounts({ unrecorded: null, todayEntries: null });
      return;
    }
    let alive = true;
    void Promise.all([
      Promise.resolve()
        .then(() => oculpmApi.compareWorkday(projectId, workday))
        .then((c) => new Set(c.sessions.flatMap((s) => s.unrecorded)).size)
        .catch(() => null),
      Promise.resolve()
        .then(() => oculpmApi.listJournalEntries(projectId, workday))
        .then((list) => list.length)
        .catch(() => null),
    ]).then(([unrecorded, todayEntries]) => {
      if (alive) setCounts({ unrecorded, todayEntries });
    });
    return () => {
      alive = false;
    };
  }, [projectId, workday, ready, tick]);

  return navBadgesOf(counts.unrecorded, counts.todayEntries, todayToCheck);
}

/** 수 → 배지. 0 과 「모름」(`null`)은 배지가 없다 — 예외만 보여 준다. */
export function navBadgesOf(
  unrecorded: number | null,
  todayEntries: number | null,
  todayToCheck?: number | null,
): NavBadges {
  const badges: NavBadges = {};
  const today = todayToCheck === undefined ? unrecorded : todayToCheck;
  if (today) badges.today = { n: today, tone: "warn" };
  if (unrecorded) badges.diff = { n: unrecorded, tone: "warn" };
  if (todayEntries) badges.journal = { n: todayEntries, tone: "dim" };
  return badges;
}
