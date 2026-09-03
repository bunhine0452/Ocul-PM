// 트리 다중 선택의 규칙 — 순수 함수만. React·DOM 을 모른다.
//
// 화면이 들고 있는 것은 뽑힌 행들(`Marks`) 과 `anchor`(⇧ 범위의 시작) 둘뿐이고,
// "이 클릭이 무슨 뜻인가" 부터 "그래서 무엇을 옮기고 지우는가" 까지의 판단은
// 전부 여기 있다. 틀리면 파일이 엉뚱한 데로 가는 쪽이라 테스트로 못박는다.
import type { CodeEntry } from "./treeUtils";

/** 뽑힌 행 하나. 폴더 여부를 같이 들고 다니는 이유는 아래 [`Marks`] 참고. */
export interface TreeMark {
  path: string;
  isDir: boolean;
}

/**
 * 뽑힌 것들 — 경로 → 폴더 여부.
 *
 * `Set<string>` 이 아니라 맵인 이유: 삭제 확인 창은 "파일을 지웁니다" 와 "폴더를
 * **그 안의 내용까지** 지웁니다" 를 다르게 말해야 하고, 뽑아 둔 경로가 스크롤
 * 밖으로 나가거나 부모가 접힌 뒤에는 트리에서 그 사실을 되찾을 수 없다. 누를
 * 때 이미 알고 있던 것을 그냥 들고 다닌다.
 */
export type Marks = ReadonlyMap<string, boolean>;

/** 클릭 한 번의 뜻. 플랫폼 관례를 여기서 한 번만 읽는다. */
export type ClickIntent = "replace" | "toggle" | "range";

export function clickIntent(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): ClickIntent {
  // ⇧ 가 ⌘ 보다 세다 — 둘 다 눌린 상태의 관례는 "범위" 다 (Finder·VS Code).
  if (e.shiftKey) return "range";
  // macOS 는 ⌘, 그 밖은 Ctrl. 둘 다 받아 두면 어느 자판에서도 손이 안 헛돈다.
  if (e.metaKey || e.ctrlKey) return "toggle";
  return "replace";
}

/**
 * 지금 트리에 **보이는** 행들을 위에서 아래 순서로.
 *
 * ⇧ 범위 선택의 유일한 기준이다. 접힌 폴더의 자식은 여기 없다 — 보이지 않는
 * 것까지 범위에 넣으면 사용자가 고른 적 없는 파일이 조용히 딸려 옮겨진다.
 */
export function visibleEntries(
  childrenOf: (dirPath: string) => CodeEntry[] | undefined,
  expanded: ReadonlySet<string>,
): TreeMark[] {
  const out: TreeMark[] = [];
  const walk = (dir: string) => {
    for (const node of childrenOf(dir) ?? []) {
      out.push({ path: node.relative_path, isDir: node.is_dir });
      if (node.is_dir && expanded.has(node.relative_path)) walk(node.relative_path);
    }
  };
  walk("");
  return out;
}

/** ⇧클릭 — anchor 부터 to 까지 (방향 무관). 기준이 없으면 누른 것 하나. */
export function rangeBetween(
  entries: readonly TreeMark[],
  anchor: string | null,
  to: string,
): TreeMark[] {
  const j = entries.findIndex((e) => e.path === to);
  const i = anchor == null ? -1 : entries.findIndex((e) => e.path === anchor);
  if (j < 0) return [];
  if (i < 0) return [entries[j]];
  return i <= j ? entries.slice(i, j + 1) : entries.slice(j, i + 1);
}

/** 여러 행 → `Marks`. */
export function marksOf(entries: readonly TreeMark[]): Map<string, boolean> {
  return new Map(entries.map((e) => [e.path, e.isDir]));
}

/** ⌘클릭 — 있으면 빼고 없으면 넣는다. 원본은 건드리지 않는다. */
export function toggleMark(marks: Marks, mark: TreeMark): Map<string, boolean> {
  const next = new Map(marks);
  if (!next.delete(mark.path)) next.set(mark.path, mark.isDir);
  return next;
}

/**
 * 조상이 이미 뽑혀 있으면 후손은 뺀다.
 *
 * `src` 와 `src/a.ts` 를 함께 옮기면 첫 이동이 `src/a.ts` 를 데려가 버려 두 번째
 * 이동은 **없는 경로**를 가리킨다. 폴더를 옮기는 것은 그 안의 것을 전부 옮기는
 * 것이므로, 후손은 애초에 따로 옮길 필요가 없다. 삭제도 같다.
 */
export function pruneNested(paths: Iterable<string>): string[] {
  // 정렬해 두면 조상이 반드시 먼저 온다 — 조상은 후손의 진짜 접두사다.
  const sorted = [...new Set(paths)].sort();
  const kept: string[] = [];
  for (const path of sorted) {
    if (!kept.some((keep) => path.startsWith(`${keep}/`))) kept.push(path);
  }
  return kept;
}

/**
 * 이 행에 건 조작이 **실제로** 데려가는 것들.
 *
 * 뽑아 둔 것 안에서 잡았으면 뽑은 전부를, 밖에서 잡았으면 그것 하나만 데려간다
 * (Finder·VS Code 와 같다 — 선택 밖을 건드리면 선택은 버려진다).
 */
export function actionTargets(marks: Marks, path: string, isDir: boolean): TreeMark[] {
  if (marks.size <= 1 || !marks.has(path)) return [{ path, isDir }];
  const kept = new Set(pruneNested(marks.keys()));
  return [...marks]
    .filter(([p]) => kept.has(p))
    .map(([p, dir]) => ({ path: p, isDir: dir }));
}
