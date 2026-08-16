// 코드 트리 순수 유틸 — 컴포넌트와 분리해 단위 테스트한다 (docs 의
// resolveDocsPath 와 같은 원칙).
import type { CodeTreeNode } from "@/lib/bindings";

/** `src/a/b.rs` → ["src", "src/a"] (파일 자신 제외). 선택 파일 조상 폴더 펼침용. */
export function ancestorDirs(path: string): string[] {
  const segs = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join("/"));
  return out;
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

/** 사람 눈에 맞는 파일 크기 표기 (상태줄·대용량 안내). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
