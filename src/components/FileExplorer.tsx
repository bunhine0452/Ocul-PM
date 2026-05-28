import { useState, useMemo, useEffect, useCallback } from "react";
import type { ProjectTreeNode } from "@/lib/bindings";
import { Folder, FolderOpen, File, Search, ChevronRight, ChevronDown } from "./Icons";

export type ChangeOp = "A" | "M" | "D";

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
  /**
   * Optional: when set, the footer is wired by the parent. We don't render
   * a footer ourselves so the CodeWorkbench / sidebar gutter can compose
   * around us.
   */
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

  // Precompute the set of directory paths that contain any descendant change,
  // so we can render an aggregate dot on collapsed folders. Memoised across
  // recentChanges identity changes.
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

  // Search filter — when the query is non-empty we expand every ancestor of
  // each match so the user sees hits without clicking. We don't *mutate* the
  // controlled `expanded` map; instead we union it with a transient set.
  const transientExpand = useMemo(() => {
    if (!searchQuery || !tree) return new Set<string>();
    const q = searchQuery.toLowerCase();
    const set = new Set<string>();
    const visit = (node: ProjectTreeNode) => {
      for (const c of node.children) {
        if (c.is_dir) {
          visit(c);
          // expand parents-of-matches: if any descendant of c matches, expand
          // c. We compute this by re-walking — fine because trees are bounded
          // by the user's project size and search is rare.
        }
      }
    };
    visit(tree);
    // Second pass: mark every directory whose subtree contains a hit.
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

  const isExpanded = useCallback(
    (relPath: string) => transientExpand.has(relPath) || !!expanded[relPath],
    [transientExpand, expanded],
  );

  // Determine file icon and accent. Lifted out so render functions stay slim.
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

  // Search-filtered recursive render. We hide nodes whose subtree matches
  // nothing once a query is active; otherwise the entire tree shows.
  const matchesQuery = useCallback(
    (node: ProjectTreeNode): boolean => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      if (node.name.toLowerCase().includes(q)) return true;
      return node.children.some((c) => matchesQuery(c));
    },
    [searchQuery],
  );

  const renderNode = (node: ProjectTreeNode, depth: number) => {
    if (!matchesQuery(node)) return null;

    if (node.is_dir) {
      const open = isExpanded(node.relative_path);
      const hasChange = dirChangeSet.has(node.relative_path);
      return (
        <div key={node.relative_path || "__root_dir"} className="select-none">
          <div
            onClick={() => onToggleExpand(node.relative_path)}
            className="flex items-center py-1 px-2 rounded-md hover:bg-accent/40 text-sm text-foreground/85 cursor-pointer transition-colors duration-150"
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
            <div className="overflow-hidden">
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
        onClick={() => onSelectFile(node.relative_path)}
        className={`flex items-center py-1 px-2 rounded-md text-xs cursor-pointer select-none transition-all duration-150 ${
          isActive
            ? "bg-primary text-primary-foreground font-semibold shadow-sm"
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

  // Auto-expand the root on first render so the user sees something.
  useEffect(() => {
    if (tree && expanded[""] === undefined) {
      onToggleExpand("");
    }
    // We only want this to fire on the *initial* tree load — once the user
    // collapses the root we mustn't re-open it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree === null]);

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
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
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
