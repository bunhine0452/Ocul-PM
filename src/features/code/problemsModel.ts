// 문제 패널 (B6) — 순수 모델.
//
// 설계 SSOT: docs/20260902_vscode-borrows/05-problems.md
// 근거: vscode/src/vs/workbench/contrib/markers
//
// "무엇을 먼저 보여 줄 것인가" 만 여기서 정한다. 목록의 순서는 눈이 처음 닿는
// 곳을 정하는 일이라, 컴포넌트 안에 있으면 조용히 바뀌어도 아무도 모른다.

import type { LspDiagnostic, LspSeverity } from "@/lib/bindings";

/** 심각도별 개수. 뱃지·정렬·필터가 전부 이 하나를 본다. */
export interface SeverityCounts {
  error: number;
  warning: number;
  info: number;
  hint: number;
}

/** 한 파일의 문제들. */
export interface ProblemFile {
  /** 프로젝트 상대 경로. */
  path: string;
  counts: SeverityCounts;
  /** 줄 → 열 오름차순. */
  items: LspDiagnostic[];
}

/** `경로 → 진단` 짝들. 스토어의 `ReadonlyMap` 이 그대로 들어맞는다. */
export type ProblemEntries = Iterable<[string, LspDiagnostic[]]>;

/** 심각한 것부터. 필터의 "이 이상" 은 이 순서를 뜻한다. */
export const SEVERITY_ORDER: readonly LspSeverity[] = ["error", "warning", "info", "hint"];

/** 파일당 한 번에 그리는 항목 수. 나머지는 "더 보기". */
export const ITEMS_PER_FILE = 50;

/**
 * 목록에 세우는 파일 수의 상한.
 *
 * 대형 리팩터 중 rust-analyzer 는 수천 개를 민다. 스토어는 전부 들되(뱃지 총계가
 * 정직해야 한다) 렌더는 여기서 끊는다 — 200개 넘는 파일 목록은 훑는 물건이 아니다.
 */
export const MAX_FILES = 200;

function emptyCounts(): SeverityCounts {
  return { error: 0, warning: 0, info: 0, hint: 0 };
}

function countOf(items: readonly LspDiagnostic[]): SeverityCounts {
  const counts = emptyCounts();
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

/**
 * `경로 → 진단` 을 파일 카드로 묶고 정렬한다.
 *
 * 파일 사이: **오류 있는 파일 먼저** → 오류 수 내림차순 → 경로 사전순.
 * 파일 안: 줄 오름차순 → 열 오름차순.
 *
 * 경로 사전순이 마지막에 오는 이유: 같은 무게의 파일들이 매번 같은 자리에 서야
 * 두 번째 볼 때 눈이 기억한 곳을 짚는다 (서버가 주는 순서는 실행마다 다르다).
 */
export function groupByFile(entries: ProblemEntries): ProblemFile[] {
  const files: ProblemFile[] = [];
  for (const [path, items] of entries) {
    if (items.length === 0) continue;
    files.push({
      path,
      counts: countOf(items),
      items: [...items].sort(
        (a, b) => a.start_line - b.start_line || a.start_character - b.start_character,
      ),
    });
  }
  return files.sort(
    (a, b) =>
      Number(b.counts.error > 0) - Number(a.counts.error > 0) ||
      b.counts.error - a.counts.error ||
      a.path.localeCompare(b.path),
  );
}

/**
 * `min` 이상으로 심각한 항목만 남긴다. 남은 것이 없는 파일은 목록에서 빠진다
 * (빈 카드가 서 있으면 "고쳤는데 왜 남아 있지" 를 묻게 된다).
 */
export function filterBySeverity(files: readonly ProblemFile[], min: LspSeverity): ProblemFile[] {
  const limit = SEVERITY_ORDER.indexOf(min);
  const out: ProblemFile[] = [];
  for (const file of files) {
    const items = file.items.filter((d) => SEVERITY_ORDER.indexOf(d.severity) <= limit);
    if (items.length === 0) continue;
    out.push({ path: file.path, counts: countOf(items), items });
  }
  return out;
}

/** 전체 합계 — 상태줄 뱃지가 읽는다. */
export function totalCounts(files: readonly ProblemFile[]): SeverityCounts {
  const total = emptyCounts();
  for (const file of files) {
    total.error += file.counts.error;
    total.warning += file.counts.warning;
    total.info += file.counts.info;
    total.hint += file.counts.hint;
  }
  return total;
}
