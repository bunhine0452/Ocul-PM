// ⌘P 빠른 열기 — 순수 모델 (2026-09-11 편집기 IDE 라운드).
//
// 왜 순수 모듈인가: "무엇이 먼저 나오는가" 는 오버레이의 렌더와 무관하고,
// jsdom 이 못 보는 자리에서 조용히 틀린다 (gotoModel · saveHygiene 과 같은 잣대).
//
// 목록의 출처는 화면이 이미 들고 있는 **전량 트리**(`code_tree`) 다 — 필터가 쓰는
// 것과 같은 것이라 서버 왕복이 없다. 점수는 시작 탭의 프로젝트 매칭(`homeMatch`)
// 을 그대로 쓴다: 접두 > 단어 경계 > 초성 > 부분수열 > 경로 부분문자열. 그래서
// `agmd` 가 `AGENTS.md` 에, `src/feat` 가 `src/features/…` 에 걸린다.

import { bestScore } from "@/features/onboarding/home/homeMatch";
import type { CodeTreeNode } from "@/lib/bindings";

export interface QuickOpenFile {
  path: string;
  name: string;
  /** 부모 폴더 (표시용 · 루트면 ""). */
  dir: string;
}

export interface RankedFile extends QuickOpenFile {
  score: number;
  /** 어느 창에든 탭으로 열려 있다 — 배지. */
  open: boolean;
}

/** 전량 트리 → 파일 목록 (폴더 제외, 문서 순서). */
export function flattenFiles(nodes: readonly CodeTreeNode[], acc: QuickOpenFile[] = []): QuickOpenFile[] {
  for (const n of nodes) {
    if (n.is_dir) {
      flattenFiles(n.children, acc);
      continue;
    }
    const slash = n.relative_path.lastIndexOf("/");
    acc.push({
      path: n.relative_path,
      name: n.name,
      dir: slash < 0 ? "" : n.relative_path.slice(0, slash),
    });
  }
  return acc;
}

/** 결과 상한 — 목록은 훑는 것이지 읽는 것이 아니다. */
export const QUICK_OPEN_LIMIT = 40;

/**
 * 질의 → 정렬된 결과.
 *
 * - 빈 질의: **열려 있는 탭**(주어진 순서 = 최근 순)만 — VS Code 의 "최근에 연
 *   파일" 자리다. 전체 목록을 쏟아 내면 첫 화면이 곧 소음이다.
 * - 질의: 점수 내림차순, 동점이면 열린 탭 우선, 그다음 **짧은 경로** (같은 이름이
 *   `mod.rs` 처럼 여럿일 때 얕은 것이 먼저), 그다음 문서 순서.
 * - 공백으로 나눈 낱말 **전부**가 맞아야 한다 (`code css` → `code.css` 와
 *   `code-frame.css`). 점수는 첫 낱말이 정한다.
 */
export function rankFiles(
  files: readonly QuickOpenFile[],
  query: string,
  openPaths: readonly string[],
  limit = QUICK_OPEN_LIMIT,
): RankedFile[] {
  const openSet = new Set(openPaths);
  const words = query.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    const byPath = new Map(files.map((f) => [f.path, f]));
    const out: RankedFile[] = [];
    for (const p of openPaths) {
      const f = byPath.get(p);
      if (f) out.push({ ...f, score: 0, open: true });
    }
    return out.slice(0, limit);
  }

  const scored: Array<RankedFile & { index: number }> = [];
  files.forEach((f, index) => {
    const first = bestScore(f.name, f.path, words[0]);
    if (first == null) return;
    for (let i = 1; i < words.length; i++) {
      if (bestScore(f.name, f.path, words[i]) == null) return;
    }
    scored.push({ ...f, score: first, open: openSet.has(f.path), index });
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.open) - Number(a.open) ||
      a.path.length - b.path.length ||
      a.index - b.index,
  );
  return scored.slice(0, limit).map(({ index: _i, ...rest }) => rest);
}
