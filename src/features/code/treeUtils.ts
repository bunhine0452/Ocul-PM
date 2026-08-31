// 코드 트리 순수 유틸 — 컴포넌트와 분리해 단위 테스트한다 (docs 의
// resolveDocsPath 와 같은 원칙).
import type { CodeDirEntry, CodeTreeNode } from "@/lib/bindings";

/**
 * 트리 한 줄이 그려지는 데 필요한 전부. 소스가 둘이라 모양을 하나로 맞춘다 —
 * 평소에는 `code_dir` 의 지연 로딩 결과가, 필터 중에는 `code_tree` 의 전량 결과가
 * 들어온다 (아래 [`flattenToDirMap`]).
 */
export type CodeEntry = CodeDirEntry;

/**
 * 부모 경로 → 자식들. 루트의 키는 `""`.
 *
 * 지연 트리는 이 모양을 그대로 캐시로 쓰고, 필터 결과는 [`flattenToDirMap`] 이
 * 같은 모양으로 펴서 넣는다. 덕분에 렌더러가 하나로 유지된다 — 트리를 통째로
 * 들고 자식을 심는 불변 수술 대신, 조회 한 번이면 된다.
 */
export type DirMap = Map<string, CodeEntry[]>;

/**
 * 필터 결과(중첩 전량 트리)를 [`DirMap`] 으로 편다.
 *
 * `code_tree` 는 gitignore 를 존중하므로 여기서 나온 것은 정의상 무시되지 않은
 * 항목이다 — `ignored: false` 로 고정한다.
 */
export function flattenToDirMap(
  nodes: CodeTreeNode[],
  parent = "",
  acc: DirMap = new Map(),
): DirMap {
  acc.set(
    parent,
    nodes.map((n) => ({
      name: n.name,
      relative_path: n.relative_path,
      is_dir: n.is_dir,
      ignored: false,
    })),
  );
  for (const n of nodes) {
    if (n.is_dir) flattenToDirMap(n.children, n.relative_path, acc);
  }
  return acc;
}

/** `src/a/b.rs` → ["src", "src/a"] (파일 자신 제외). 선택 파일 조상 폴더 펼침용. */
export function ancestorDirs(path: string): string[] {
  const segs = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join("/"));
  return out;
}

/** 키를 물어볼 수 있는 것 — [`DirMap`] 도 `Set<string>` 도 그대로 들어온다. */
export interface DirLookup {
  has(key: string): boolean;
}

/**
 * 바뀐 파일의 조상 중 **이미 읽어 둔** 가장 가까운 폴더. 없으면 `null`.
 *
 * 직계 부모를 그냥 다시 읽으면 안 되는 이유: 폴더째로 생긴 파일
 * (`a/b/c.ts` 에서 `a/b` 가 새 폴더)은 그 부모가 캐시에 없어서, 다시 읽어 봐야
 * 아무 데도 안 붙는다. 새 폴더가 목록에 나타나려면 캐시에 있는 가장 가까운
 * 조상(`a`)을 읽어야 한다. 루트(`""`)는 트리를 한 번이라도 읽었으면 늘 있다.
 */
export function nearestCachedDir(path: string, cached: DirLookup): string | null {
  const dirs = ancestorDirs(path);
  for (let i = dirs.length - 1; i >= 0; i--) {
    if (cached.has(dirs[i])) return dirs[i];
  }
  return cached.has("") ? "" : null;
}

/**
 * 트리 필터 — 대소문자 무시 부분 일치. 파일은 **전체 상대 경로**로 매치해
 * "graph/pal" 같은 경로 조각도 찾힌다. 폴더 이름이 매치되면 하위 전체 유지,
 * 아니면 매치되는 후손만 남긴 채 가지를 유지한다. 원본은 변형하지 않는다.
 */
export function filterTree(nodes: CodeTreeNode[], query: string): CodeTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const out: CodeTreeNode[] = [];
  for (const node of nodes) {
    if (node.is_dir) {
      if (node.name.toLowerCase().includes(q)) {
        out.push(node);
        continue;
      }
      const kept = filterTree(node.children, query);
      if (kept.length > 0) out.push({ ...node, children: kept });
    } else if (node.relative_path.toLowerCase().includes(q)) {
      out.push(node);
    }
  }
  return out;
}

/** 트리의 모든 폴더 경로 (필터 시 전체 펼침용). */
export function collectDirs(nodes: CodeTreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.is_dir) {
      acc.push(n.relative_path);
      collectDirs(n.children, acc);
    }
  }
  return acc;
}

/** 트리의 모든 파일 경로 (선택 경로 유효성 검사용). */
export function collectFiles(nodes: CodeTreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.is_dir) collectFiles(n.children, acc);
    else acc.push(n.relative_path);
  }
  return acc;
}

/** 사람 눈에 맞는 파일 크기 표기 (상태줄·대용량 안내) — `lib/format` 공용. */
export { formatBytes } from "@/lib/format";
