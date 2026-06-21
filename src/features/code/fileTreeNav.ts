// Pure file-tree keyboard-navigation helpers, extracted from the retired
// `src/legacy/FileExplorer.tsx` (PR-UI 7) so their safety-net coverage in
// `lite_w6_safety_net.test.ts` survives the legacy folder's removal. No
// React/DOM dependency — operate on a `ProjectTreeNode` + a controlled
// `expanded` map only.

/**
 * A node in a project file tree. Mirrors the shape the (now-retired)
 * `list_project_tree` backend command produced; kept here, with its only
 * remaining consumer, so the helpers stay self-contained.
 */
export interface ProjectTreeNode {
  name: string;
  /** Forward-slash relative path from the project root; `""` for the root. */
  relative_path: string;
  is_dir: boolean;
  children: ProjectTreeNode[];
}

/**
 * One entry per *visible* node in DFS order — i.e. respecting the controlled
 * `expanded` map. Used by the a11y keyboard-nav logic and unit-tested in
 * isolation from the DOM.
 */
export interface FlatNode {
  /** `""` for the synthetic root we don't render directly. */
  path: string;
  name: string;
  isDir: boolean;
  /** 0 for top-level children of the project root, 1 for `src/x`, etc. */
  depth: number;
  /** Parent's `relative_path`; `""` when the parent is the root. */
  parentPath: string;
}

/**
 * Walk `tree` in DFS order, respecting `expanded`, and emit one entry per
 * visible node.
 */
export function flattenVisibleNodes(
  tree: ProjectTreeNode | null,
  expanded: Record<string, boolean>,
): FlatNode[] {
  if (!tree) return [];
  const out: FlatNode[] = [];
  const visit = (node: ProjectTreeNode, depth: number, parentPath: string) => {
    out.push({
      path: node.relative_path,
      name: node.name,
      isDir: node.is_dir,
      depth,
      parentPath,
    });
    if (node.is_dir && expanded[node.relative_path]) {
      for (const c of node.children) {
        visit(c, depth + 1, node.relative_path);
      }
    }
  };
  for (const top of tree.children) {
    visit(top, 0, "");
  }
  return out;
}

/**
 * Compute the next focused path for an arrow-key event against the flat
 * list. Returns `null` if focus shouldn't move (e.g. ↑ at the top item).
 * Folder expand/collapse side-effects are reported via the optional
 * `onExpand` / `onCollapse` callbacks rather than mutating state here so
 * the function stays pure for tests.
 */
export function nextFocusedPath(
  visible: FlatNode[],
  current: string | null,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End",
  expanded: Record<string, boolean>,
  onExpand?: (path: string) => void,
  onCollapse?: (path: string) => void,
): string | null {
  if (visible.length === 0) return null;
  const idx = current ? visible.findIndex((n) => n.path === current) : -1;
  switch (key) {
    case "Home":
      return visible[0]?.path ?? null;
    case "End":
      return visible[visible.length - 1]?.path ?? null;
    case "ArrowUp": {
      if (idx <= 0) return visible[0]?.path ?? null;
      return visible[idx - 1]?.path ?? null;
    }
    case "ArrowDown": {
      if (idx < 0) return visible[0]?.path ?? null;
      if (idx >= visible.length - 1) return null;
      return visible[idx + 1]?.path ?? null;
    }
    case "ArrowRight": {
      if (idx < 0) return visible[0]?.path ?? null;
      const node = visible[idx];
      if (node.isDir) {
        if (!expanded[node.path]) {
          onExpand?.(node.path);
          return null;
        }
        // Already expanded — descend into first child if present.
        const next = visible[idx + 1];
        if (next && next.parentPath === node.path) return next.path;
      }
      return null;
    }
    case "ArrowLeft": {
      if (idx < 0) return visible[0]?.path ?? null;
      const node = visible[idx];
      if (node.isDir && expanded[node.path]) {
        onCollapse?.(node.path);
        return null;
      }
      // Move to parent.
      if (node.parentPath) return node.parentPath;
      return null;
    }
  }
}
