// 전역 검색 패널의 순수 로직 (#project-search) — 컴포넌트와 분리해 테스트한다.

import type { CodeSearchFile, CodeSearchResult } from "@/lib/bindings";

/** 검색 매칭 토글 — WorkspaceContext 의 `codeSearchOpts` 와 같은 모양. */
export interface SearchOpts {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** 미리보기 조각 — `hit` 인 조각만 하이라이트로 그린다. */
export interface PreviewSegment {
  text: string;
  hit: boolean;
}

/**
 * 백엔드가 준 UTF-16 좌표로 미리보기를 셋으로 가른다. JS 문자열 인덱스가
 * 그 단위라 그대로 자르면 된다 — 좌표가 범위 밖이면(방어) 전체를 평문으로.
 */
export function previewSegments(preview: string, col: number, len: number): PreviewSegment[] {
  if (col < 0 || len <= 0 || col + len > preview.length) {
    return [{ text: preview, hit: false }];
  }
  const out: PreviewSegment[] = [];
  if (col > 0) out.push({ text: preview.slice(0, col), hit: false });
  out.push({ text: preview.slice(col, col + len), hit: true });
  if (col + len < preview.length) out.push({ text: preview.slice(col + len), hit: false });
  return out;
}

/** 파일 하나를 목록에서 뺀다 (제외 버튼). 합계도 같이 줄인다. */
export function dropFile(result: CodeSearchResult, path: string): CodeSearchResult {
  const file = result.files.find((f) => f.path === path);
  if (!file) return result;
  return {
    ...result,
    files: result.files.filter((f) => f.path !== path),
    total_hits: result.total_hits - file.hits.length,
  };
}

/** 치환 대상 경로들 — 미저장 파일은 빼고, 몇 개를 뺐는지 같이 알린다. */
export function replaceablePaths(
  files: CodeSearchFile[],
  dirtyPaths: ReadonlySet<string>,
): { paths: string[]; skippedDirty: number } {
  const paths = files.map((f) => f.path).filter((p) => !dirtyPaths.has(p));
  return { paths, skippedDirty: files.length - paths.length };
}

/** 경로 → (이름, 폴더) — 좁은 사이드바에서 이름을 앞세워 그린다. */
export function splitPath(path: string): { name: string; dir: string } {
  const at = path.lastIndexOf("/");
  return at < 0 ? { name: path, dir: "" } : { name: path.slice(at + 1), dir: path.slice(0, at) };
}
