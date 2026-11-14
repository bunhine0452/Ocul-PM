/**
 * 일지 화면이 **앱이 켜 있는 동안** 기억하는 것 — 마지막으로 고른 일지와 목록 스크롤 (11-15).
 *
 * 셸은 지금 화면 하나만 그린다(ShellV2) — 계획으로 갔다 돌아오면 일지 화면이 새로 서고, 고른 일지와
 * 읽던 자리가 사라져 첫 줄부터 다시 찾았다. 디스크 · localStorage 에는 남기지 않는다: 다음 실행은
 * 처음부터다(필터 · 검색을 열 때마다 비우는 것과 같은 이유 — 어제의 자리가 오늘의 착각이 된다).
 */

interface JournalMemory {
  /** 마지막으로 고른 일지 (`.oculpm/journal/` 기준 경로). */
  path: string | null;
  /** 목록 칸의 스크롤 위치(px). */
  scrollTop: number;
}

const byProject = new Map<number, JournalMemory>();

export function rememberedJournal(projectId: number): JournalMemory | undefined {
  return byProject.get(projectId);
}

export function rememberJournal(projectId: number, patch: Partial<JournalMemory>): void {
  const cur = byProject.get(projectId) ?? { path: null, scrollTop: 0 };
  byProject.set(projectId, { ...cur, ...patch });
}

/** 시험용 — 모듈 저장소는 시험 사이에 남는다. */
export function __resetJournalMemory(): void {
  byProject.clear();
}
