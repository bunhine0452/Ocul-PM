import { useEffect, useState, useMemo, useCallback } from "react";
import hljs from "highlight.js";
import {
  commands,
  type DependencyGraph,
  type SymbolDef,
} from "@/lib/bindings";
import { useSettings } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  RefreshCw,
  X,
  FileCode,
  ChevronRight,
  GitBranch,
} from "@/components/Icons";

// Warm depth palette tuned to the app's coral/cream theme
const DEPTH_PALETTE = [
  { name: "Roots",   color: "#cc785c" }, // coral (primary)
  { name: "Layer 1", color: "#c19353" }, // amber
  { name: "Layer 2", color: "#7a8b5a" }, // sage
  { name: "Layer 3", color: "#5d8a8a" }, // muted teal
  { name: "Layer 4", color: "#a86b8a" }, // plum
];

const depthMeta = (layer: number) => {
  const entry = DEPTH_PALETTE[layer] ?? DEPTH_PALETTE[DEPTH_PALETTE.length - 1];
  return {
    color: entry.color,
    label: layer === 0 ? "Roots" : `Layer ${layer}`,
  };
};

// Language badge config keyed by extension
const LANG_BADGES: Record<string, { label: string; fg: string; bg: string; border: string }> = {
  rs:    { label: "Rust",   fg: "#b75d3d", bg: "#cc785c14", border: "#cc785c33" },
  ts:    { label: "TS",     fg: "#3b6ea8", bg: "#3b6ea814", border: "#3b6ea833" },
  tsx:   { label: "TSX",    fg: "#3b6ea8", bg: "#3b6ea814", border: "#3b6ea833" },
  js:    { label: "JS",     fg: "#a08234", bg: "#a0823414", border: "#a0823433" },
  jsx:   { label: "JSX",    fg: "#a08234", bg: "#a0823414", border: "#a0823433" },
  astro: { label: "Astro",  fg: "#ff5a03", bg: "#ff5a0314", border: "#ff5a0333" },
  mjs:   { label: "JS",     fg: "#a08234", bg: "#a0823414", border: "#a0823433" },
  cjs:   { label: "JS",     fg: "#a08234", bg: "#a0823414", border: "#a0823433" },
  py:    { label: "Python", fg: "#577a4a", bg: "#577a4a14", border: "#577a4a33" },
  go:    { label: "Go",     fg: "#3d8a93", bg: "#3d8a9314", border: "#3d8a9333" },
  java:  { label: "Java",   fg: "#a05c3d", bg: "#a05c3d14", border: "#a05c3d33" },
  kt:    { label: "Kotlin", fg: "#7a5da8", bg: "#7a5da814", border: "#7a5da833" },
  kts:   { label: "Kotlin", fg: "#7a5da8", bg: "#7a5da814", border: "#7a5da833" },
  swift: { label: "Swift",  fg: "#cc6b4a", bg: "#cc6b4a14", border: "#cc6b4a33" },
  rb:    { label: "Ruby",   fg: "#a8403d", bg: "#a8403d14", border: "#a8403d33" },
  php:   { label: "PHP",    fg: "#5d6ba8", bg: "#5d6ba814", border: "#5d6ba833" },
  cs:    { label: "C#",     fg: "#5a8a4a", bg: "#5a8a4a14", border: "#5a8a4a33" },
  c:     { label: "C",      fg: "#6b7a8a", bg: "#6b7a8a14", border: "#6b7a8a33" },
  h:     { label: "C/H",    fg: "#6b7a8a", bg: "#6b7a8a14", border: "#6b7a8a33" },
  cpp:   { label: "C++",    fg: "#5d7aa0", bg: "#5d7aa014", border: "#5d7aa033" },
  cc:    { label: "C++",    fg: "#5d7aa0", bg: "#5d7aa014", border: "#5d7aa033" },
  cxx:   { label: "C++",    fg: "#5d7aa0", bg: "#5d7aa014", border: "#5d7aa033" },
  hpp:   { label: "C++/H",  fg: "#5d7aa0", bg: "#5d7aa014", border: "#5d7aa033" },
  hh:    { label: "C++/H",  fg: "#5d7aa0", bg: "#5d7aa014", border: "#5d7aa033" },
};

function langBadgeFor(ext: string) {
  return (
    LANG_BADGES[ext] ?? {
      label: ext.toUpperCase() || "FILE",
      fg: "var(--muted-foreground)",
      bg: "color-mix(in srgb, var(--muted-foreground) 8%, transparent)",
      border: "color-mix(in srgb, var(--muted-foreground) 25%, transparent)",
    }
  );
}

/// Trim deeply nested paths to "first/…/last" form so directory headers stay
/// readable even when paths are very long.
function smartTruncatePath(path: string, maxLen = 32): string {
  const cleaned = path.replace(/^\.\//, "");
  if (cleaned.length <= maxLen) return cleaned;
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length <= 2) return cleaned;
  for (let keep = parts.length - 1; keep >= 2; keep--) {
    const lastN = parts.slice(-keep).join("/");
    const candidate = `${parts[0]}/…/${lastN}`;
    if (candidate.length <= maxLen) return candidate;
  }
  return `…/${parts.slice(-2).join("/")}`;
}

/// Group files by their parent directory, sorted alphabetically.
function buildDirGroups<T extends { path: string }>(
  nodes: T[]
): Array<{ dir: string; nodes: T[] }> {
  const byDir = new Map<string, T[]>();
  for (const node of nodes) {
    const dir = node.path.split("/").slice(0, -1).join("/");
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(node);
  }
  return Array.from(byDir.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, nodes]) => ({ dir, nodes }));
}

function DependencyGraphInner({
  projectId,
  onOpenFile,
}: {
  projectId: number;
  onOpenFile?: (filePath: string, startLine?: number) => void;
}) {
  const { settings } = useSettings();
  const GROUP_THRESHOLD = settings.graphGroupThreshold;

  const [rawGraph, setRawGraph] = useState<DependencyGraph | null>(null);
  const [symbolsMap, setSymbolsMap] = useState<Record<string, SymbolDef[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showIsolatedNodes, setShowIsolatedNodes] = useState(settings.graphShowIsolated);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const [previewSymbol, setPreviewSymbol] = useState<{
    symbolName: string;
    filePath: string;
    kind: string;
    startLine: number;
    endLine: number;
    codeSnippet: string;
    lang: string;
  } | null>(null);

  const fetchSymbolsForFile = useCallback(
    async (fileId: number, filePath: string) => {
      if (symbolsMap[filePath]) return;
      try {
        const res = await commands.getFileSymbols(fileId);
        if (res.status === "ok") {
          setSymbolsMap((prev) => ({ ...prev, [filePath]: res.data }));
        }
      } catch (err) {
        console.error("Failed to load symbols for file:", filePath, err);
      }
    },
    [symbolsMap]
  );

  const fetchGraphAndSymbols = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const graphRes = await commands.getDependencyGraph(projectId);
      if (graphRes.status === "error") throw new Error(graphRes.error);
      setRawGraph(graphRes.data);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to load dependency graph.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchGraphAndSymbols();
  }, [fetchGraphAndSymbols]);

  useEffect(() => {
    if (!previewSymbol) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewSymbol(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewSymbol]);

  const groupedNodesByLayer = useMemo(() => {
    if (!rawGraph) return [];

    const dbNodes = rawGraph.nodes;
    const dbEdges = rawGraph.edges;

    const connectedNodeIds = new Set<number>();
    dbEdges.forEach((e) => {
      connectedNodeIds.add(e.source_file_id);
      connectedNodeIds.add(e.target_file_id);
    });

    const filteredNodes =
      !showIsolatedNodes && connectedNodeIds.size > 0
        ? dbNodes.filter((n) => connectedNodeIds.has(n.file_id))
        : dbNodes;

    const filteredFileIds = new Set(filteredNodes.map((n) => n.file_id));

    const layers: Record<string, number> = {};
    let currentNodes = filteredNodes.map((n) => String(n.file_id));
    let currentLayer = 0;

    while (currentNodes.length > 0) {
      const nextNodes: string[] = [];
      currentNodes.forEach((id) => {
        const hasIncomingFromRemaining = dbEdges.some(
          (e) =>
            String(e.target_file_id) === id &&
            filteredFileIds.has(e.source_file_id) &&
            currentNodes.includes(String(e.source_file_id))
        );
        if (!hasIncomingFromRemaining) {
          layers[id] = currentLayer;
        } else {
          nextNodes.push(id);
        }
      });

      if (nextNodes.length === currentNodes.length) {
        currentNodes.forEach((id) => {
          layers[id] = currentLayer;
        });
        break;
      }
      currentNodes = nextNodes;
      currentLayer++;
    }

    const maxLayer = Math.max(...Object.values(layers), -1);
    const groups: Array<{ layer: number; nodes: typeof filteredNodes }> = [];
    for (let l = 0; l <= maxLayer; l++) {
      groups.push({ layer: l, nodes: [] });
    }

    filteredNodes.forEach((node) => {
      const l = layers[String(node.file_id)] ?? 0;
      if (groups[l]) groups[l].nodes.push(node);
    });

    groups.forEach((g) => {
      g.nodes.sort((a, b) => a.path.localeCompare(b.path));
    });

    return groups.filter((g) => g.nodes.length > 0);
  }, [rawGraph, showIsolatedNodes]);

  const filePathToLayer = useMemo(() => {
    const map = new Map<string, number>();
    groupedNodesByLayer.forEach((group) => {
      group.nodes.forEach((node) => {
        map.set(node.path, group.layer);
      });
    });
    return map;
  }, [groupedNodesByLayer]);

  // Search-as-filter: when typing in the search box, filter cards live in every
  // layer rather than just selecting the first match.
  const visibleGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedNodesByLayer;
    const q = searchQuery.toLowerCase();
    return groupedNodesByLayer
      .map((g) => ({
        ...g,
        nodes: g.nodes.filter((n) => n.path.toLowerCase().includes(q)),
      }))
      .filter((g) => g.nodes.length > 0);
  }, [groupedNodesByLayer, searchQuery]);

  const isFiltering = searchQuery.trim().length > 0;
  const totalVisible = useMemo(
    () => visibleGroups.reduce((sum, g) => sum + g.nodes.length, 0),
    [visibleGroups]
  );

  const connectedNodeIds = useMemo(() => {
    const activeId = hoveredNodeId
      ? Number(hoveredNodeId)
      : selectedFilePath && rawGraph
      ? rawGraph.nodes.find((n) => n.path === selectedFilePath)?.file_id
      : null;

    if (!activeId || !rawGraph) return new Set<number>();

    const ids = new Set<number>([activeId]);
    rawGraph.edges.forEach((e) => {
      if (e.source_file_id === activeId) ids.add(e.target_file_id);
      if (e.target_file_id === activeId) ids.add(e.source_file_id);
    });
    return ids;
  }, [hoveredNodeId, selectedFilePath, rawGraph]);

  const executeSearch = () => {
    if (!searchQuery.trim() || !rawGraph) return;
    const matchedNode = rawGraph.nodes.find((n) =>
      n.path.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (matchedNode) {
      setSelectedFilePath(matchedNode.path);
      fetchSymbolsForFile(matchedNode.file_id, matchedNode.path);
    }
  };

  const selectFileByPath = useCallback(
    (path: string) => {
      if (!rawGraph) return;
      const matchedNode = rawGraph.nodes.find((n) => n.path === path);
      if (matchedNode) {
        setSelectedFilePath(path);
        fetchSymbolsForFile(matchedNode.file_id, path);
      }
    },
    [rawGraph, fetchSymbolsForFile]
  );

  const handleSymbolClick = async (sym: SymbolDef, filePath: string) => {
    try {
      const res = await commands.readProjectFile(projectId, filePath);
      if (res.status === "ok") {
        const lines = res.data.split("\n");
        const start = Math.max(1, sym.start_line);
        const end = Math.min(lines.length, sym.end_line);
        const slicedLines = lines.slice(start - 1, end);
        const codeSnippet = slicedLines.join("\n");

        const ext = filePath.split(".").pop() || "";
        let lang = "javascript";
        if (ext === "rs") lang = "rust";
        else if (ext === "py") lang = "python";
        else if (ext === "go") lang = "go";
        else if (["ts", "tsx"].includes(ext)) lang = "typescript";
        else if (ext === "astro") lang = "xml"; // Astro doesn't have a default lang in highlight.js, using xml as base

        setPreviewSymbol({
          symbolName: sym.name,
          filePath,
          kind: sym.kind,
          startLine: start,
          endLine: end,
          codeSnippet,
          lang,
        });
      } else {
        console.error("Failed to read file for preview:", res.error);
      }
    } catch (err) {
      console.error("Error reading file for preview:", err);
    }
  };

  const inspectorDeps = useMemo(() => {
    if (!selectedFilePath || !rawGraph) return { incoming: [], outgoing: [] };

    const selectedNode = rawGraph.nodes.find((n) => n.path === selectedFilePath);
    if (!selectedNode) return { incoming: [], outgoing: [] };

    const selectedFileId = selectedNode.file_id;

    const incoming = rawGraph.edges
      .filter((e) => e.target_file_id === selectedFileId)
      .map((e) => {
        const found = rawGraph.nodes.find((n) => n.file_id === e.source_file_id);
        return found ? found.path : "";
      })
      .filter(Boolean);

    const outgoing = rawGraph.edges
      .filter((e) => e.source_file_id === selectedFileId)
      .map((e) => {
        const found = rawGraph.nodes.find((n) => n.file_id === e.target_file_id);
        return found ? found.path : "";
      })
      .filter(Boolean);

    return { incoming, outgoing };
  }, [selectedFilePath, rawGraph]);

  const selectedFileSymbols = useMemo(() => {
    if (!selectedFilePath) return [];
    return symbolsMap[selectedFilePath] || [];
  }, [selectedFilePath, symbolsMap]);

  const previewHighlightedCode = useMemo(() => {
    if (!previewSymbol) return "";
    try {
      return hljs.highlight(previewSymbol.codeSnippet, { language: previewSymbol.lang }).value;
    } catch (e) {
      return hljs.highlightAuto(previewSymbol.codeSnippet).value;
    }
  }, [previewSymbol]);

  const previewLineNumbers = useMemo(() => {
    if (!previewSymbol) return "";
    const nums = [];
    for (let i = previewSymbol.startLine; i <= previewSymbol.endLine; i++) {
      nums.push(i);
    }
    return nums.join("\n");
  }, [previewSymbol]);

  return (
    <div className="flex h-full w-full relative overflow-hidden bg-background">
      {/* Left side: Pipeline board */}
      <div className="flex-1 min-w-0 flex flex-col relative h-full">
        {/* Controls Header */}
        <div className="absolute top-4 left-4 right-4 z-10 flex gap-2 items-center bg-card/80 backdrop-blur-md border border-border rounded-xl p-2 shadow-sm">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Filter file path..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && executeSearch()}
              className="h-9 pl-9 pr-8 bg-background border-border text-foreground placeholder-muted-foreground focus-visible:ring-primary"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Clear filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button
            size="sm"
            onClick={executeSearch}
            className="h-9 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Find
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowIsolatedNodes((prev) => !prev)}
            className={`h-9 text-xs transition-all border-border ${
              !showIsolatedNodes
                ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/15"
                : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {!showIsolatedNodes ? "Show All Files" : "Show Connected Only"}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchGraphAndSymbols}
            disabled={loading}
            className="h-9 w-9 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>

          <div className="ml-auto flex items-center gap-3 pr-2 text-[11px] text-muted-foreground">
            {groupedNodesByLayer.length > 0 && (
              <>
                {isFiltering ? (
                  <span className="font-mono">
                    <span className="text-foreground font-semibold">{totalVisible}</span>
                    {" / "}
                    {rawGraph?.nodes.length ?? 0} files
                  </span>
                ) : (
                  <span className="font-mono">
                    {rawGraph?.nodes.length ?? 0} files
                  </span>
                )}
                <span className="opacity-30">·</span>
                <span className="font-mono">
                  {visibleGroups.length} layers
                </span>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="absolute top-20 left-4 z-10 bg-destructive/10 border border-destructive/30 text-destructive px-4 py-2.5 rounded-lg max-w-md text-xs backdrop-blur-sm">
            {error}
          </div>
        )}

        {/* Board Container */}
        <div className="flex-1 overflow-x-auto flex gap-5 p-5 pt-20 h-full items-stretch scrollbar-thin select-none">
          {visibleGroups.length > 0 ? (
            visibleGroups.map((group) => {
              const meta = depthMeta(group.layer);
              const dirGroups = buildDirGroups(group.nodes);

              const renderCard = (node: typeof group.nodes[number], showPath: boolean) => {
                const idNum = node.file_id;
                const idStr = String(idNum);
                const isSelf = idStr === hoveredNodeId || node.path === selectedFilePath;
                const isRelated = connectedNodeIds.has(idNum) && !isSelf;
                const hasActiveSelection = hoveredNodeId !== null || selectedFilePath !== null;
                const isDimmed = hasActiveSelection && !isSelf && !isRelated;
                const active = node.path === selectedFilePath;

                let incoming = 0;
                let outgoing = 0;
                if (rawGraph) {
                  incoming = rawGraph.edges.filter((e) => e.target_file_id === idNum).length;
                  outgoing = rawGraph.edges.filter((e) => e.source_file_id === idNum).length;
                }

                const fileName = node.path.split("/").pop() || "";
                const dirPath = node.path.split("/").slice(0, -1).join("/");
                const ext = fileName.split(".").pop() || "";
                const badge = langBadgeFor(ext);

                const cardStyle: React.CSSProperties = {
                  backgroundImage: `linear-gradient(to right, ${meta.color}1c 0%, transparent 40%)`,
                };
                if (active) {
                  cardStyle.boxShadow = `0 0 0 2px ${meta.color}55, 0 1px 2px rgba(0,0,0,0.04)`;
                } else if (isRelated) {
                  cardStyle.boxShadow = `0 0 0 1px ${meta.color}55`;
                }

                return (
                  <div
                    key={idNum}
                    onMouseEnter={() => setHoveredNodeId(idStr)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    onClick={() => {
                      setSelectedFilePath(node.path);
                      fetchSymbolsForFile(idNum, node.path);
                    }}
                    style={cardStyle}
                    className={`group relative flex-shrink-0 rounded-lg border border-border bg-background hover:bg-card transition-all duration-200 cursor-pointer overflow-hidden ${
                      isDimmed ? "opacity-30" : ""
                    } ${active ? "bg-card" : ""}`}
                  >
                    <div className="px-3 py-2.5">
                      {showPath && (
                        <div
                          className="text-[10px] font-mono truncate mb-0.5 text-muted-foreground/70 group-hover:text-muted-foreground transition-colors"
                          title={dirPath ? `./${dirPath}/` : "./"}
                        >
                          {dirPath ? `./${dirPath}/` : "./"}
                        </div>
                      )}

                      <div
                        className="text-sm font-semibold text-foreground group-hover:text-foreground truncate"
                        title={fileName}
                      >
                        {fileName}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/60">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold tracking-wider uppercase"
                          style={{
                            color: badge.fg,
                            backgroundColor: badge.bg,
                            border: `1px solid ${badge.border}`,
                          }}
                        >
                          {badge.label}
                        </span>

                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                          <span title="Incoming dependencies" className="flex items-center gap-0.5">
                            <span className="opacity-60">←</span>
                            {incoming}
                          </span>
                          <span className="opacity-30">·</span>
                          <span title="Outgoing dependencies" className="flex items-center gap-0.5">
                            <span className="opacity-60">→</span>
                            {outgoing}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              };

              return (
                <div
                  key={group.layer}
                  className="flex-shrink-0 w-72 flex flex-col max-h-full rounded-2xl border border-border bg-card/60 overflow-hidden shadow-sm"
                >
                  {/* Column Header */}
                  <div
                    className="px-4 py-3 border-b border-border bg-card/80 flex items-center justify-between"
                    style={{
                      backgroundImage: `linear-gradient(to right, ${meta.color}24 0%, transparent 60%)`,
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      <span className="text-sm font-semibold text-foreground tracking-tight">
                        {meta.label}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase tracking-wider"
                        style={{
                          color: meta.color,
                          backgroundColor: `${meta.color}14`,
                          border: `1px solid ${meta.color}33`,
                        }}
                      >
                        D{group.layer}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {group.nodes.length} {group.nodes.length === 1 ? "file" : "files"}
                    </span>
                  </div>

                  {/* Column Body — grouped by directory */}
                  <div className="flex-1 min-h-0 overflow-y-auto p-2.5 flex flex-col gap-2.5 scrollbar-thin">
                    {dirGroups.map((dg) => {
                      const groupKey = `${group.layer}:${dg.dir}`;
                      const useHeader = dg.nodes.length >= GROUP_THRESHOLD;
                      // While filtering, force-expand so search results are visible.
                      const isCollapsed =
                        useHeader && !isFiltering && collapsedGroups.has(groupKey);
                      const displayDir = dg.dir || ".";
                      const truncated = smartTruncatePath(displayDir, 30);

                      return (
                        <div
                          key={dg.dir || "(root)"}
                          className="flex flex-col gap-1.5 flex-shrink-0"
                        >
                          {useHeader && (
                            <button
                              onClick={() => toggleGroup(groupKey)}
                              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors text-left cursor-pointer"
                              title={displayDir}
                            >
                              <ChevronRight
                                className={`w-3 h-3 flex-shrink-0 transition-transform ${
                                  isCollapsed ? "" : "rotate-90"
                                }`}
                                style={{ color: meta.color }}
                              />
                              <span className="font-mono truncate flex-1">
                                {truncated || "./"}
                              </span>
                              <span
                                className="text-[10px] tabular-nums flex-shrink-0 px-1.5 py-0.5 rounded"
                                style={{
                                  color: meta.color,
                                  backgroundColor: `${meta.color}14`,
                                }}
                              >
                                {dg.nodes.length}
                              </span>
                            </button>
                          )}

                          {!isCollapsed && (
                            <div className="flex flex-col gap-2">
                              {dg.nodes.map((node) => renderCard(node, !useHeader))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="w-full flex flex-col items-center justify-center py-20 text-center">
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                  <span className="text-sm text-muted-foreground font-medium">
                    Loading dependency board...
                  </span>
                </div>
              ) : isFiltering ? (
                <div className="flex flex-col items-center gap-3">
                  <Search className="w-8 h-8 text-muted-foreground/60" />
                  <span className="text-sm text-muted-foreground">
                    No files match "<span className="font-mono">{searchQuery}</span>".
                  </span>
                  <button
                    onClick={() => setSearchQuery("")}
                    className="text-xs text-primary hover:underline cursor-pointer"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <GitBranch className="w-8 h-8 text-muted-foreground/60" />
                  <span className="text-sm text-muted-foreground">
                    No project files found or indexed yet.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right side: Inspector */}
      {selectedFilePath && (
        <div className="w-96 border-l border-border bg-card/95 backdrop-blur-xl h-full flex flex-col z-20 shadow-xl animate-in slide-in-from-right duration-300">
          <div className="p-4 border-b border-border flex justify-between items-start gap-4">
            <div className="overflow-hidden flex-1">
              <span className="text-[10px] text-muted-foreground font-mono block truncate">
                {selectedFilePath.split("/").slice(0, -1).join("/") || "./"}
              </span>
              <div className="flex items-center gap-2 mt-1">
                <h3
                  className="text-sm font-bold text-foreground truncate"
                  title={selectedFilePath.split("/").pop() || ""}
                >
                  {selectedFilePath.split("/").pop()}
                </h3>
                {onOpenFile && (
                  <button
                    onClick={() => onOpenFile(selectedFilePath)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="Open in Editor"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedFilePath(null)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 scrollbar-thin">
            <div>
              <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-primary" /> Connections
              </h4>
              <div className="flex flex-col gap-4">
                <div>
                  <span className="text-[10px] text-muted-foreground block mb-1.5">
                    Imported by ({inspectorDeps.incoming.length})
                  </span>
                  {inspectorDeps.incoming.length > 0 ? (
                    <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-1 scrollbar-thin">
                      {inspectorDeps.incoming.map((path) => {
                        const layer = filePathToLayer.get(path) ?? 0;
                        const meta = depthMeta(layer);
                        return (
                          <button
                            key={path}
                            onClick={() => selectFileByPath(path)}
                            className="flex items-center justify-between text-left text-xs bg-background hover:bg-muted text-foreground px-2.5 py-1.5 rounded-xl border border-border transition-all duration-200 w-full group cursor-pointer"
                            style={{
                              backgroundImage: `linear-gradient(to right, ${meta.color}1c 0%, transparent 40%)`,
                            }}
                          >
                            <span className="truncate flex-1 font-mono text-[11px] mr-2">
                              {path.split("/").pop()}
                            </span>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase tracking-wider"
                                style={{
                                  color: meta.color,
                                  backgroundColor: `${meta.color}14`,
                                  border: `1px solid ${meta.color}33`,
                                }}
                              >
                                D{layer}
                              </span>
                              <ChevronRight className="w-3 h-3 text-muted-foreground/60 group-hover:text-foreground flex-shrink-0" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground/70 block italic pl-2">
                      No incoming imports.
                    </span>
                  )}
                </div>

                <div>
                  <span className="text-[10px] text-muted-foreground block mb-1.5">
                    Imports ({inspectorDeps.outgoing.length})
                  </span>
                  {inspectorDeps.outgoing.length > 0 ? (
                    <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-1 scrollbar-thin">
                      {inspectorDeps.outgoing.map((path) => {
                        const layer = filePathToLayer.get(path) ?? 0;
                        const meta = depthMeta(layer);
                        return (
                          <button
                            key={path}
                            onClick={() => selectFileByPath(path)}
                            className="flex items-center justify-between text-left text-xs bg-background hover:bg-muted text-foreground px-2.5 py-1.5 rounded-xl border border-border transition-all duration-200 w-full group cursor-pointer"
                            style={{
                              backgroundImage: `linear-gradient(to right, ${meta.color}1c 0%, transparent 40%)`,
                            }}
                          >
                            <span className="truncate flex-1 font-mono text-[11px] mr-2">
                              {path.split("/").pop()}
                            </span>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase tracking-wider"
                                style={{
                                  color: meta.color,
                                  backgroundColor: `${meta.color}14`,
                                  border: `1px solid ${meta.color}33`,
                                }}
                              >
                                D{layer}
                              </span>
                              <ChevronRight className="w-3 h-3 text-muted-foreground/60 group-hover:text-foreground flex-shrink-0" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground/70 block italic pl-2">
                      No outgoing imports.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-primary" /> Symbols ({selectedFileSymbols.length})
              </h4>
              {selectedFileSymbols.length > 0 ? (
                <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
                  {selectedFileSymbols.map((sym, i) => {
                    let typeFg = "var(--muted-foreground)";
                    let typeBg = "color-mix(in srgb, var(--muted-foreground) 10%, transparent)";
                    let typeBorder = "color-mix(in srgb, var(--muted-foreground) 25%, transparent)";
                    if (["function", "method"].includes(sym.kind)) {
                      typeFg = "#5d8a8a";
                      typeBg = "#5d8a8a14";
                      typeBorder = "#5d8a8a33";
                    } else if (["struct", "class", "interface"].includes(sym.kind)) {
                      typeFg = "#cc785c";
                      typeBg = "#cc785c14";
                      typeBorder = "#cc785c33";
                    } else if (["enum", "trait", "type"].includes(sym.kind)) {
                      typeFg = "#c19353";
                      typeBg = "#c1935314";
                      typeBorder = "#c1935333";
                    }

                    return (
                      <button
                        key={`${sym.name}-${i}`}
                        onClick={() => handleSymbolClick(sym, selectedFilePath)}
                        className="w-full flex items-center justify-between text-left text-xs bg-background hover:bg-muted px-3 py-2 rounded-lg border border-border hover:border-primary/40 transition-all group/sym cursor-pointer"
                      >
                        <div className="overflow-hidden mr-2 flex-1">
                          <span
                            className="font-semibold text-foreground group-hover/sym:text-primary font-mono truncate block"
                            title={sym.name}
                          >
                            {sym.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground block mt-0.5">
                            Lines {sym.start_line} – {sym.end_line}
                          </span>
                        </div>
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded font-bold font-mono tracking-wider flex-shrink-0 uppercase"
                          style={{ color: typeFg, backgroundColor: typeBg, border: `1px solid ${typeBorder}` }}
                        >
                          {sym.kind}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground/70 block italic pl-2">
                  No symbols indexed in this file.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Code Snippet Preview Modal */}
      {previewSymbol && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 transition-all duration-300">
          <div className="bg-card border border-border w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-border bg-card/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-mono font-bold tracking-wider uppercase"
                  style={{
                    color: "#cc785c",
                    backgroundColor: "#cc785c14",
                    border: "1px solid #cc785c33",
                  }}
                >
                  {previewSymbol.kind}
                </span>
                <div className="overflow-hidden">
                  <h3 className="text-sm font-semibold text-foreground font-mono truncate max-w-md">
                    {previewSymbol.symbolName}
                  </h3>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-lg">
                    {previewSymbol.filePath} • Lines {previewSymbol.startLine} – {previewSymbol.endLine}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(previewSymbol.codeSnippet)}
                  className="px-2.5 py-1.5 rounded-lg bg-background hover:bg-muted border border-border text-[10px] font-medium text-foreground transition-all cursor-pointer"
                >
                  Copy Code
                </button>
                <button
                  onClick={() => setPreviewSymbol(null)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer border border-transparent hover:border-border"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-background flex relative min-h-0 select-text p-4">
              <pre
                className="select-none text-right bg-transparent text-muted-foreground/40 border-r border-border overflow-hidden pr-3 mr-3"
                style={{
                  fontSize: "13px",
                  lineHeight: "22px",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  margin: 0,
                  padding: 0,
                  boxSizing: "border-box",
                  minWidth: "40px",
                }}
              >
                {previewLineNumbers}
              </pre>

              <pre
                className="flex-1 whitespace-pre overflow-auto bg-transparent m-0 p-0"
                style={{
                  fontSize: "13px",
                  lineHeight: "22px",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  margin: 0,
                  padding: 0,
                }}
              >
                <code
                  className="hljs block whitespace-pre bg-transparent border-0"
                  style={{
                    fontSize: "13px",
                    lineHeight: "22px",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    padding: 0,
                    margin: 0,
                    background: "transparent",
                  }}
                  dangerouslySetInnerHTML={{ __html: previewHighlightedCode }}
                />
              </pre>
            </div>

            <div className="p-3 bg-card/80 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Press Escape or click close button to return to dependency pipeline.</span>
              <button
                onClick={() => {
                  const filePath = previewSymbol.filePath;
                  const startLine = previewSymbol.startLine;
                  setPreviewSymbol(null);
                  if (onOpenFile) onOpenFile(filePath, startLine);
                }}
                className="text-primary hover:underline font-semibold cursor-pointer"
              >
                Open full file in Editor →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DependencyGraphView({
  projectId,
  onOpenFile,
}: {
  projectId: number;
  onOpenFile?: (filePath: string, startLine?: number) => void;
}) {
  return <DependencyGraphInner projectId={projectId} onOpenFile={onOpenFile} />;
}
