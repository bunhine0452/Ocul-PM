/**
 * 시작 창·⌘O 목록의 자료 — 최근 활동 순 프로젝트와 줄마다 숫자 둘.
 *
 * 숫자는 둘뿐이다: **오늘(또는 마지막 날) 기록 수**와 **확인할 것** — 오늘 에이전트가
 * 고치고 일지에 안 적은 파일 수(`compare_workday` 의 미기록). 둘 다 로컬 SQLite 질의라
 * 가볍고, 못 읽은 줄은 `null`(모름), 아직 안 물은 줄은 `undefined`(칩 없음)로 남는다.
 *
 * 규칙 넷 (3.x 시작 탭의 `useHomeBrief` 를 이었다):
 *  1. **실패해도 목록은 선다.** 집계가 실패하면 이름·경로만으로 그린다.
 *  2. **다시 읽는 동안 비우지 않는다.** 창을 오갈 때마다 깜빡이면 그게 더 나쁘다.
 *  3. **창으로 돌아오면 다시 읽는다** (15초 간격) — 다른 앱에서 에이전트를 돌리다
 *     왔을 수 있고, 시작 창에는 워처가 그리는 화면이 없다.
 *  4. **모름과 없음을 가른다** (11-15). 목록 · 브리프를 같이 묻고(`Promise.all`), 브리프가 오기 전은
 *     「pending」, 실패는 「failed」 다 — 예전엔 브리프 전 모든 줄이 「기록 없음」 으로 섰다가 재정렬됐고,
 *     실패하면 그대로였다. 목록 조회가 실패하면 영원히 비던 것도 `error` 로 말한다(다시 시도).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { projectsApi } from "@/api/projects";
import { tError } from "@/i18n/errors";
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
  /**
   * 오늘 일지 없이 바뀐 파일 수. 물었는데 못 읽었으면 `null`(모름 — 회색 「—」), 아직 안 물었으면 `undefined`(칩 없음):
   * 답을 기다리는 동안과 `CHECK_CAP` 밖의 줄이다. 둘을 하나로 치면 열세 번째 줄부터 「아직 세지 못했어요」 가
   * 영영 섰고, 창을 열 때마다 모든 줄에 「—」 가 섰다 사라졌다.
   */
  toCheck: number | null | undefined;
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
    return { project, lastWorkday, dayCount, toCheck: checks.has(project.id) ? (checks.get(project.id) ?? null) : undefined };
  });
}

/** 날짜 칸의 재료 — 오기 전 · 왔음 · 못 읽음. */
export type BriefState = "pending" | "ok" | "failed";

export interface UseRecentProjects {
  rows: RecentProject[];
  /** 첫 목록 조회가 끝났나 — 조회 전의 빈 배열을 「프로젝트 0개」로 오해하지 않게. */
  loaded: boolean;
  /** 목록을 못 읽었다(보여 줄 줄이 없을 때만 의미가 있다 — 다시 읽기 실패는 앞 목록을 그대로 둔다). */
  error: string | null;
  brief: BriefState;
  reload: () => void;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(p: () => Promise<T>): Promise<Settled<T>> {
  return Promise.resolve()
    .then(p)
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
}

export function useRecentProjects(): UseRecentProjects {
  const [projects, setProjects] = useState<Project[]>([]);
  const [brief, setBrief] = useState<HomeBrief | null>(null);
  const [briefState, setBriefState] = useState<BriefState>("pending");
  const [checks, setChecks] = useState<Map<number, number | null>>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const lastFetch = useRef(0);

  const fetch = useCallback(async () => {
    const mine = ++seq.current;
    lastFetch.current = Date.now();
    const [listRes, briefRes] = await Promise.all([settle(() => projectsApi.list()), settle(() => projectsApi.brief(BRIEF_DAYS))]);
    if (mine !== seq.current) return;
    const list = listRes.ok ? listRes.value : null;
    if (listRes.ok) {
      setProjects(listRes.value);
      setLoaded(true);
      setError(null);
    } else {
      setError(tError(toAppError(listRes.error)) || String(listRes.error));
    }
    const b = briefRes.ok ? briefRes.value : null;
    if (b) {
      setBrief(b);
      setBriefState("ok");
    } else {
      // 다시 읽기의 실패는 앞 값을 지운다고 낫지 않다 — 처음 읽기만 「못 읽음」 이 된다.
      setBriefState((s) => (s === "ok" ? s : "failed"));
    }
    // 목록을 못 읽었으면 「일지 없는 파일」 도 앞 값 그대로 둔다(규칙 2).
    if (!list) return;
    const today = localWorkdayKey();
    const ids = orderRecent(list, b)
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
  return {
    rows: toRecentRows(projects, brief, checks, localWorkdayKey()),
    loaded,
    error,
    brief: briefState,
    reload,
  };
}
