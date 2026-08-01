/**
 * 프로젝트 관리 페이지 모델 — 순수 함수만. React 의존 0.
 *
 * 메인 화면(home)의 모델이 "어디서 이어서 일하지?" 를 위계로 답한다면, 이쪽의
 * 질문은 정반대다: **"내 워크스페이스에 뭐가 들어 있지?"** 그래서 티어(사령탑/
 * 판/색인)를 만들지 않고 **정렬 가능한 평면 목록** 하나만 낸다 — 관리 작업은
 * 훑고(sort) 고르고(select) 지우는 것이지, 추천받는 게 아니다.
 *
 * 검색 매칭은 메인 화면과 같은 규칙(`homeMatch`)을 쓴다. 두 화면이 같은 질의에
 * 다른 결과를 내면 그 자체가 버그다.
 */
import type { HomeBrief, Project } from "@/lib/bindings";
import { bestScore } from "@/features/onboarding/home/homeMatch";

export type ManagerSortKey = "name" | "recent" | "entries";
export type SortDir = "asc" | "desc";

export interface ManagerRow {
  project: Project;
  /** 마지막 기록 시각 (ISO). 집계 전이거나 기록이 없으면 null. */
  lastAt: string | null;
  totalEntries: number;
  todayCount: number;
}

export interface BuildManagerRowsArgs {
  projects: Project[];
  /** `null` = 집계 미도착/실패. 그래도 목록은 이름·경로만으로 전부 선다. */
  brief: HomeBrief | null;
  query: string;
  sort: ManagerSortKey;
  dir: SortDir;
}

/**
 * 열을 처음 눌렀을 때의 방향. 이름은 ㄱ→ㅎ 이 자연스럽고, 시각·건수는 큰 값이
 * 먼저여야 유용하다 (관리 화면에서 찾는 건 보통 "제일 최근" 이나 "제일 많은" 것).
 */
const FIRST_DIR: Record<ManagerSortKey, SortDir> = {
  name: "asc",
  recent: "desc",
  entries: "desc",
};

export function firstDir(key: ManagerSortKey): SortDir {
  return FIRST_DIR[key];
}

export function buildManagerRows(args: BuildManagerRowsArgs): ManagerRow[] {
  const { projects, brief, query, sort, dir } = args;

  const briefById = new Map((brief?.projects ?? []).map((b) => [b.project_id, b]));

  const q = query.trim();
  const rows: ManagerRow[] = [];
  for (const p of projects) {
    if (q && bestScore(p.name, p.root_path, q) === null) continue;
    const b = briefById.get(p.id);
    rows.push({
      project: p,
      lastAt: b?.last_at ?? null,
      totalEntries: b?.total_entries ?? 0,
      todayCount: b?.today_count ?? 0,
    });
  }

  const sign = dir === "asc" ? 1 : -1;
  rows.sort((a, b) => sign * compareAsc(a, b, sort));
  return rows;
}

/**
 * 오름차순 기준 비교. 동률은 **항상 이름**으로 깬다 — 안 그러면 기록 0건이
 * 여럿일 때 목록 순서가 배열 순서를 따라 흔들려, 같은 화면을 두 번 열면 줄이
 * 바뀌어 보인다 (관리 화면에서 그건 곧 오클릭이다).
 */
function compareAsc(a: ManagerRow, b: ManagerRow, key: ManagerSortKey): number {
  if (key === "entries" && a.totalEntries !== b.totalEntries) {
    return a.totalEntries - b.totalEntries;
  }
  if (key === "recent") {
    // ISO 8601 은 사전순 = 시간순. 기록이 없으면 "" 라 오름차순에서 맨 앞으로
    // 간다 (= 내림차순에서는 맨 뒤) — 활동이 있는 쪽이 먼저 보이는 게 맞다.
    const la = a.lastAt ?? "";
    const lb = b.lastAt ?? "";
    if (la !== lb) return la < lb ? -1 : 1;
  }
  return a.project.name.localeCompare(b.project.name, "ko");
}
