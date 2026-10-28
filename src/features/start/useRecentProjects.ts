/**
 * 시작 창·⌘O 목록의 자료 — 최근 활동 순 프로젝트와 줄마다 숫자 둘.
 *
 * 숫자는 둘뿐이다: **오늘(또는 마지막 날) 기록 수**와 **확인할 것** — 오늘 에이전트가
 * 고치고 일지에 안 적은 파일 수(`compare_workday` 의 미기록). 둘 다 로컬 SQLite 질의라
 * 가볍고, 못 읽은 줄은 `null` 로 남는다 — 화면은 그 칸을 비운다.
 *
 * 규칙 셋 (3.x 시작 탭의 `useHomeBrief` 를 이었다):
 *  1. **실패해도 목록은 선다.** 집계가 실패하면 이름·경로만으로 그린다.
 *  2. **다시 읽는 동안 비우지 않는다.** 창을 오갈 때마다 깜빡이면 그게 더 나쁘다.
 *  3. **창으로 돌아오면 다시 읽는다** (15초 간격) — 다른 앱에서 에이전트를 돌리다
 *     왔을 수 있고, 시작 창에는 워처가 그리는 화면이 없다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { projectsApi } from "@/api/projects";
import type { HomeBrief, Project } from "@/lib/bindings";
import { localWorkdayKey, shiftWorkday } from "@/lib/workday";

/** 집계 창 — 오늘과 어제. 그보다 오래된 날은 날짜만 말한다. */
const BRIEF_DAYS = 2;
/** 「확인할 것」을 묻는 최대 프로젝트 수 — 그 뒤 줄은 칸을 비운다. */
const CHECK_CAP = 12;
const REFETCH_THROTTLE_MS = 15_000;

export interface RecentProject {
  project: Project;
  /** 마지막 활동 날 (YYYYMMDD) — 일지가 하나도 없으면 `null`. */
  lastWorkday: string | null;
  /** 그날 기록 수 — 오늘·어제만 센다(그 밖은 `null`). */
  dayCount: number | null;
  /** 확인할 것 — 오늘 기록 없이 바뀐 파일 수. 모르면 `null`. */
  toCheck: number | null;
}

function lastAtOf(brief: HomeBrief | null, id: number): string {
  return brief?.projects.find((p) => p.project_id === id)?.last_at ?? "";
}

/** 최근 활동 순 — 일지가 없는 프로젝트는 등록이 늦은 것부터 뒤에 선다. */
export function orderRecent(projects: Project[], brief: HomeBrief | null): Project[] {
  return [...projects].sort((a, b) => {
    const la = lastAtOf(brief, a.id);
    const lb = lastAtOf(brief, b.id);
    if (la !== lb) return la < lb ? 1 : -1;
    return b.created_at - a.created_at;
  });
}

export function toRecentRows(
  projects: Project[],
  brief: HomeBrief | null,
  checks: Map<number, number | null>,
  today: string,
): RecentProject[] {
  const yesterday = shiftWorkday(today, -1);
  return orderRecent(projects, brief).map((project) => {
    const b = brief?.projects.find((p) => p.project_id === project.id) ?? null;
    const lastWorkday = b?.last_workday ?? null;
    const dayCount =
      lastWorkday === today
        ? (b?.today_count ?? null)
        : lastWorkday === yesterday
          ? (b?.days.find((d) => d.workday === yesterday)?.count ?? null)
          : null;
    return { project, lastWorkday, dayCount, toCheck: checks.get(project.id) ?? null };
  });
}

export interface UseRecentProjects {
  rows: RecentProject[];
  /** 첫 목록 조회가 끝났나 — 조회 전의 빈 배열을 「프로젝트 0개」로 오해하지 않게. */
  loaded: boolean;
  reload: () => void;
}

export function useRecentProjects(): UseRecentProjects {
  const [projects, setProjects] = useState<Project[]>([]);
  const [brief, setBrief] = useState<HomeBrief | null>(null);
  const [checks, setChecks] = useState<Map<number, number | null>>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);
  const lastFetch = useRef(0);

  const fetch = useCallback(async () => {
    const mine = ++seq.current;
    lastFetch.current = Date.now();
    const list = await projectsApi.list().catch(() => null);
    if (mine !== seq.current) return;
    if (list) {
      setProjects(list);
      setLoaded(true);
    }
    const b = await projectsApi.brief(BRIEF_DAYS).catch(() => null);
    if (mine !== seq.current) return;
    if (b) setBrief(b);
    const today = localWorkdayKey();
    const ids = orderRecent(list ?? [], b)
      .slice(0, CHECK_CAP)
      .map((p) => p.id);
    const pairs = await Promise.all(
      ids.map(async (id) => {
        const n = await Promise.resolve()
          .then(() => oculpmApi.compareWorkday(id, today))
          .then((c) => new Set(c.sessions.flatMap((s) => s.unrecorded)).size)
          .catch(() => null);
        return [id, n] as const;
      }),
    );
    if (mine === seq.current) setChecks(new Map(pairs));
  }, []);

  useEffect(() => {
    void fetch();
    return () => {
      // 언마운트 뒤 도착한 답을 버린다.
      seq.current += 1;
    };
  }, [fetch]);

  useEffect(() => {
    const maybeRefetch = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastFetch.current < REFETCH_THROTTLE_MS) return;
      void fetch();
    };
    window.addEventListener("focus", maybeRefetch);
    document.addEventListener("visibilitychange", maybeRefetch);
    return () => {
      window.removeEventListener("focus", maybeRefetch);
      document.removeEventListener("visibilitychange", maybeRefetch);
    };
  }, [fetch]);

  const reload = useCallback(() => void fetch(), [fetch]);
  return { rows: toRecentRows(projects, brief, checks, localWorkdayKey()), loaded, reload };
}
