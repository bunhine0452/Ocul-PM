import { useCallback, useSyncExternalStore } from "react";

/**
 * 검증 칸 받은함 — 터미널에서 「검증 칸으로」 보낸 결과 끝 줄들 (UI 밀도 라운드 3).
 *
 * 「다음 일지의 검증 칸에 미리 들어가 있어요」의 실체다: 프로젝트별 목록, 세션 메모리.
 * 수동 일지 작성기가 열릴 때 비어 있는 본문에 `## 검증` 절로 미리 채우고 비운다.
 * 에이전트가 쓰는 일지에는 닿지 않는다 — 클립보드에도 같은 줄이 복사되므로 붙이는
 * 것은 사람의 손이다. 디스크에는 아무것도 쓰지 않는다.
 */
const byProject = new Map<number, string[]>();
const listeners = new Set<() => void>();
const EMPTY: readonly string[] = [];
const CAP = 20;

function emit() {
  for (const fn of listeners) fn();
}

export const evidenceInbox = {
  push(projectId: number, line: string): void {
    const cur = byProject.get(projectId) ?? [];
    if (cur.includes(line)) return;
    byProject.set(projectId, [...cur, line].slice(-CAP));
    emit();
  },
  list(projectId: number | null | undefined): readonly string[] {
    return projectId == null ? EMPTY : (byProject.get(projectId) ?? EMPTY);
  },
  /** 작성기가 가져가면 비운다 — 같은 줄이 두 일지에 들어가지 않게. */
  drain(projectId: number): string[] {
    const cur = byProject.get(projectId) ?? [];
    byProject.delete(projectId);
    if (cur.length) emit();
    return cur;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  _reset(): void {
    byProject.clear();
    emit();
  },
};

export function useEvidenceInbox(projectId: number | null | undefined): readonly string[] {
  const snapshot = useCallback(() => evidenceInbox.list(projectId), [projectId]);
  return useSyncExternalStore(evidenceInbox.subscribe, snapshot, snapshot);
}

// i18n-ignore-next-line -- 일지 본문의 섹션 헤더 (디스크 문서 규격, 표시 문자열 아님)
const HEADER_KO = "## 검증";
const HEADER_EN = "## Verification";

/** 받은함을 `## 검증` 절 마크다운으로. 비어 있으면 빈 문자열. */
export function evidenceSection(lines: readonly string[], lang: "ko" | "en" = "ko"): string {
  if (lines.length === 0) return "";
  return `${lang === "en" ? HEADER_EN : HEADER_KO}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
}
