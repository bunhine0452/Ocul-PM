import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import type { PromiseScorecard } from "@/lib/bindings";
import { localWorkdayKey } from "@/lib/workday";

/** 프로젝트 하나의 숫자 셋 — 성적표(30일) + 오늘 미기록 파일 수. `null` 은 아직/모름. */
export interface ProjectScore {
  /** bug/feature/refactor 중 명령 증거 비율(%). 분모 0 이면 null. */
  evidencePct: number | null;
  /** bug 중 7일 안 같은 파일 재수정 비율(%). 분모 0 이면 null. */
  reworkPct: number | null;
  /** 오늘 에이전트가 고치고 적지 않은 파일의 고유 수. */
  unrecorded: number | null;
}

/** 시작 탭이 한 번에 묻는 최대 프로젝트 수 — 그 뒤는 「—」. 광고가 아니라 원장이라 한도가 있다. */
const CAP = 30;

function fold(sc: PromiseScorecard | null, unrecorded: number | null): ProjectScore {
  const j = sc?.journal;
  return {
    evidencePct: j && j.judged_entries > 0 ? Math.round((j.evidence_entries / j.judged_entries) * 100) : null,
    reworkPct: j && j.bug_entries > 0 ? Math.round((j.rework_within_7d / j.bug_entries) * 100) : null,
    unrecorded,
  };
}

/**
 * 원장 행의 숫자 — 프로젝트마다 성적표와 오늘 비교를 한 번씩 (UI 밀도 라운드 3, 시안 Start).
 * 둘 다 로컬 SQLite 질의라 가볍고, 실패한 프로젝트는 `null` 로 남는다 — 「—」가 곧 모름이다.
 */
export function useProjectScores(projectIds: readonly number[]): Map<number, ProjectScore> {
  const key = projectIds.slice(0, CAP).join(",");
  const [scores, setScores] = useState<Map<number, ProjectScore>>(() => new Map());
  useEffect(() => {
    const ids = key ? key.split(",").map(Number) : [];
    if (ids.length === 0) return;
    let alive = true;
    const today = localWorkdayKey();
    void Promise.all(
      ids.map(async (id) => {
        const [sc, cmp] = await Promise.all([
          Promise.resolve().then(() => oculpmApi.promiseScorecard(id, 30)).catch(() => null),
          Promise.resolve()
            .then(() => oculpmApi.compareWorkday(id, today))
            .then((c) => new Set(c.sessions.flatMap((s) => s.unrecorded)).size)
            .catch(() => null),
        ]);
        return [id, fold(sc, cmp)] as const;
      }),
    ).then((pairs) => {
      if (alive) setScores(new Map(pairs));
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return scores;
}
