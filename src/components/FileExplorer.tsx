import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { ProjectTreeNode } from "@/lib/bindings";
import { Folder, FolderOpen, File, Search, ChevronRight, ChevronDown } from "./Icons";

export type ChangeOp = "A" | "M" | "D";

/**
 * Flattened DFS order of every *visible* node in the tree — i.e. respecting
 * the controlled `expanded` map. Exported (with `flattenVisibleNodes`) so the
 * a11y keyboard navigation logic can be unit-tested in isolation from the
 * DOM. Lite-W6 PR8 Part 3.
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

interface FileExplorerProps {
  /** Directory tree from `commands.listProjectTree`. `null` while loading. */
  tree: ProjectTreeNode | null;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  /**
   * Per-path change badge — keyed by the same `relative_path` the backend
   * emits. Files in the map render a dot marker + op badge; directories that
   * contain any changed descendant render a softer dot.
   */
  recentChanges?: Record<string, ChangeOp>;
  /** Controlled expanded map. Keys are `relative_path` for folder nodes. */
  expanded: Record<string, boolean>;
  onToggleExpand: (relPath: string) => void;
}

/**
 * Walk `tree` in DFS order, respecting `expanded`, and emit one entry per
 * visible node. Public for unit testing of the keyboard nav logic.
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

export function FileExplorer({
  tree,
  activeFile,
  onSelectFile,
  recentChanges,
  expanded,
  onToggleExpand,
}: FileExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Precompute the set of directory paths that contain any descendant change,
  // so we can render an aggregate dot on collapsed folders.
  const dirChangeSet = useMemo(() => {
    const set = new Set<string>();
    if (!recentChanges) return set;
    for (const path of Object.keys(recentChanges)) {
      const parts = path.split("/");
      let acc = "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        set.add(acc);
      }
    }
    return set;
  }, [recentChanges]);

  // Search filter — when the query is non-empty we transiently mark every
  // ancestor of each match as expanded so hits aren't hidden.
  const transientExpand = useMemo(() => {
    if (!searchQuery || !tree) return new Set<string>();
    const q = searchQuery.toLowerCase();
    const set = new Set<string>();
    const matches = (node: ProjectTreeNode): boolean => {
      if (!node.is_dir && node.name.toLowerCase().includes(q)) return true;
      let any = false;
      for (const c of node.children) {
        if (matches(c)) {
          if (c.is_dir) set.add(c.relative_path);
          any = true;
        }
      }
      return any;
    };
    matches(tree);
    return set;
  }, [searchQuery, tree]);

  const effectiveExpanded = useMemo(() => {
    if (transientExpand.size === 0) return expanded;
    const merged: Record<string, boolean> = { ...expanded };
    for (const p of transientExpand) merged[p] = true;
    return merged;
  }, [expanded, transientExpand]);

  const flatVisible = useMemo(
    () => flattenVisibleNodes(tree, effectiveExpanded),
    [tree, effectiveExpanded],
  );

  const isExpanded = useCallback(
    (relPath: string) => transientExpand.has(relPath) || !!expanded[relPath],
    [transientExpand, expanded],
  );

  // Keep the focused element in view + DOM-focused when state changes.
  useEffect(() => {
    if (!focusedPath) return;
    const el = itemRefs.current.get(focusedPath);
    if (el) {
      el.focus({ preventScroll: false });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [focusedPath]);

  // Determine file icon and accent.
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "rs":
        return { icon: <span className="text-[#dea584] font-bold text-[10px] w-4 text-center">🦀</span>, color: "text-[#dea584]" };
      case "tsx":
      case "ts":
        return { icon: <span className="text-[#3178c6] font-bold text-[10px] w-4 text-center">TS</span>, color: "text-[#3178c6]" };
      case "jsx":
      case "js":
        return { icon: <span className="text-[#f1e05a] font-bold text-[10px] w-4 text-center">JS</span>, color: "text-[#f1e05a]" };
      case "json":
        return { icon: <span className="text-[#ccc] font-bold text-[10px] w-4 text-center">{}</span>, color: "text-[#e8b63a]" };
      case "md":
        return { icon: <span className="text-[#6c6a64] font-bold text-[10px] w-4 text-center">📖</span>, color: "text-muted-foreground" };
      case "css":
        return { icon: <span className="text-[#563d7c] font-bold text-[10px] w-4 text-center">CSS</span>, color: "text-[#563d7c]" };
      default:
        return { icon: <File className="w-4 h-4" />, color: "text-muted-foreground/80" };
    }
  };

  const matchesQuery = useCallback(
    (node: ProjectTreeNode): boolean => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      if (node.name.toLowerCase().includes(q)) return true;
      return node.children.some((c) => matchesQuery(c));
    },
    [searchQuery],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown" &&
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight" &&
      e.key !== "Home" &&
      e.key !== "End" &&
      e.key !== "Enter" &&
      e.key !== " "
    ) {
      return;
    }
    e.preventDefault();
    if (e.key === "Enter" || e.key === " ") {
      const target = focusedPath ?? flatVisible[0]?.path;
      if (!target) return;
      const node = flatVisible.find((n) => n.path === target);
      if (!node) return;
      if (node.isDir) {
        onToggleExpand(node.path);
      } else {
        onSelectFile(node.path);
      }
      return;
    }
    const next = nextFocusedPath(
      flatVisible,
      focusedPath,
      e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End",
      effectiveExpanded,
      (p) => onToggleExpand(p),
      (p) => onToggleExpand(p),
    );
    if (next !== null) setFocusedPath(next);
  };

  const renderNode = (node: ProjectTreeNode, depth: number) => {
    if (!matchesQuery(node)) return null;

    const isFocused = focusedPath === node.relative_path;
    const setItemRef = (el: HTMLDivElement | null) => {
      if (el) itemRefs.current.set(node.relative_path, el);
      else itemRefs.current.delete(node.relative_path);
    };

    if (node.is_dir) {
      const open = isExpanded(node.relative_path);
      const hasChange = dirChangeSet.has(node.relative_path);
      return (
        <div key={node.relative_path || "__root_dir"} className="select-none">
          <div
            ref={setItemRef}
            role="treeitem"
            aria-expanded={open}
            aria-level={depth + 1}
            tabIndex={isFocused ? 0 : -1}
            onClick={() => {
              setFocusedPath(node.relative_path);
              onToggleExpand(node.relative_path);
            }}
            onFocus={() => setFocusedPath(node.relative_path)}
            className={`flex items-center py-1 px-2 rounded-md text-sm text-foreground/85 cursor-pointer transition-colors duration-150 outline-none ${
              isFocused
                ? "bg-accent ring-1 ring-primary/40"
                : "hover:bg-accent/40"
            }`}
            style={{ paddingLeft: `${depth * 10 + 8}px` }}
          >
            <span className="mr-1 text-muted-foreground/60">
              {open ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
            {hasChange && (
              <span
                aria-hidden
                className="mr-1.5 inline-block w-1.5 h-1.5 rounded-full bg-primary/50"
                title="이 폴더 안에 변경된 파일 있음"
              />
            )}
            <span className="mr-2 text-primary/80">
              {open ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
            </span>
            <span className="truncate font-medium text-xs">{node.name}</span>
          </div>
          {open && (
            <div role="group">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // File node
    const isActive = activeFile === node.relative_path;
    const op = recentChanges?.[node.relative_path];
    const { icon, color } = getFileIcon(node.name);

    return (
      <div
        key={node.relative_path}
        ref={setItemRef}
        role="treeitem"
        aria-selected={isActive}
        aria-level={depth + 1}
        tabIndex={isFocused ? 0 : -1}
        onClick={() => {
          setFocusedPath(node.relative_path);
          onSelectFile(node.relative_path);
        }}
        onFocus={() => setFocusedPath(node.relative_path)}
        className={`flex items-center py-1 px-2 rounded-md text-xs cursor-pointer select-none transition-all duration-150 outline-none ${
          isActive
            ? "bg-primary text-primary-foreground font-semibold shadow-sm"
            : isFocused
              ? "bg-accent ring-1 ring-primary/40 text-foreground/80"
              : "hover:bg-accent/40 text-foreground/80"
        }`}
        style={{ paddingLeft: `${depth * 10 + 26}px` }}
      >
        {op ? (
          <span
            aria-label={`변경: ${op}`}
            className={`mr-1.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
              isActive ? "bg-primary-foreground" : "bg-primary"
            }`}
          />
        ) : (
          <span aria-hidden className="mr-1.5 inline-block w-1.5 h-1.5 shrink-0" />
        )}
        <span className={`mr-2 shrink-0 ${isActive ? "text-primary-foreground" : color}`}>
          {icon}
        </span>
        <span className="truncate">{node.name}</span>
        {op && (
          <span
            className={`ml-auto text-[10px] font-bold tracking-wider shrink-0 ${
              isActive ? "text-primary-foreground" : opColor(op)
            }`}
            aria-hidden
          >
            {op}
          </span>
        )}
      </div>
    );
  };

  // Auto-expand the root + seed focus on the first visible node on initial
  // tree load. Once the user collapses or moves focus, we don't second-guess.
  useEffect(() => {
    if (tree && expanded[""] === undefined) {
      onToggleExpand("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree === null]);

  useEffect(() => {
    if (focusedPath === null && flatVisible.length > 0) {
      setFocusedPath(flatVisible[0].path);
    }
  }, [flatVisible, focusedPath]);

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-border glassy-sidebar">
      {/* Search Input */}
      <div className="p-3 border-b border-border/80">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-secondary/80 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/80 transition-colors"
          />
        </div>
      </div>

      {/* Directory Tree */}
      <div
        ref={treeRef}
        role="tree"
        aria-label="프로젝트 파일 트리"
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-y-auto p-2 scrollbar-thin focus:outline-none"
        tabIndex={focusedPath ? -1 : 0}
      >
        {!tree ? (
          <div className="text-center text-muted-foreground/60 py-8 text-xs">Loading…</div>
        ) : tree.children.length === 0 ? (
          <div className="text-center text-muted-foreground/60 py-8 text-xs">
            No files found
          </div>
        ) : (
          <div className="space-y-0.5">
            {tree.children.map((child) => renderNode(child, 0))}
          </div>
        )}
      </div>
    </div>
  );
}

function opColor(op: ChangeOp): string {
  switch (op) {
    case "A":
      return "text-emerald-600 dark:text-emerald-400";
    case "M":
      return "text-amber-600 dark:text-amber-400";
    case "D":
      return "text-destructive";
  }
}
