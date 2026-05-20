import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
  Node,
  Edge,
  Handle,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  commands,
  type DependencyGraph,
  type SymbolDef,
} from "@/lib/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  RefreshCw,
  X,
  FileCode,
  ChevronRight,
  GitBranch,
} from "lucide-react";

// Custom node data structure
interface CustomNodeData {
  file_path: string;
  language: string | null;
  isSelected?: boolean;
}

// Custom Node Component
const CustomNode = ({ data }: { data: CustomNodeData }) => {
  const ext = data.file_path.split(".").pop() || "";
  const isRust = ext === "rs";
  const isTS = ["ts", "tsx"].includes(ext);
  const isJS = ["js", "jsx", "mjs", "cjs"].includes(ext);
  const isPython = ext === "py";
  const isGo = ext === "go";

  let badgeColor = "bg-zinc-800 text-zinc-400 border border-zinc-700";
  let badgeLabel = ext.toUpperCase();

  if (isRust) {
    badgeColor = "bg-amber-950/60 text-amber-300 border border-amber-800/40";
    badgeLabel = "Rust";
  } else if (isTS) {
    badgeColor = "bg-blue-950/60 text-blue-300 border border-blue-800/40";
    badgeLabel = "TS";
  } else if (isJS) {
    badgeColor = "bg-yellow-950/60 text-yellow-300 border border-yellow-800/40";
    badgeLabel = "JS";
  } else if (isPython) {
    badgeColor = "bg-emerald-950/60 text-emerald-300 border border-emerald-800/40";
    badgeLabel = "Python";
  } else if (isGo) {
    badgeColor = "bg-cyan-950/60 text-cyan-300 border border-cyan-800/40";
    badgeLabel = "Go";
  }

  const parts = data.file_path.split("/");
  const fileName = parts.pop() || "";
  const dirPath = parts.join("/");

  return (
    <div
      className={`px-4 py-3 rounded-xl border bg-zinc-900/90 backdrop-blur-md transition-all duration-300 text-zinc-100 min-w-[220px] hover:scale-105 hover:border-zinc-500 ${
        data.isSelected
          ? "border-violet-500 shadow-lg shadow-violet-950/30 ring-2 ring-violet-500/20"
          : "border-zinc-800 shadow-md"
      }`}
    >
      <Handle type="target" position={Position.Left} className="w-2.5 h-2.5 bg-zinc-700 border border-zinc-800" />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-zinc-400 font-mono truncate max-w-[180px]" title={dirPath}>
          {dirPath ? `./${dirPath}` : "./"}
        </span>
        <span className="text-sm font-semibold truncate max-w-[180px]" title={fileName}>
          {fileName}
        </span>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800/40">
          <span className={`text-[9px] px-2 py-0.5 rounded font-bold font-mono tracking-wider uppercase ${badgeColor}`}>
            {badgeLabel}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="w-2.5 h-2.5 bg-zinc-700 border border-zinc-800" />
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

function DependencyGraphInner({ projectId }: { projectId: number }) {
  const { setCenter } = useReactFlow();
  const [rawGraph, setRawGraph] = useState<DependencyGraph | null>(null);
  const [symbolsMap, setSymbolsMap] = useState<Record<string, SymbolDef[]>>({});
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  
  // Selection Inspector state
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  const fetchSymbolsForFile = useCallback(async (fileId: number, filePath: string) => {
    if (symbolsMap[filePath]) return;
    try {
      const res = await commands.getFileSymbols(fileId);
      if (res.status === "ok") {
        setSymbolsMap((prev) => ({
          ...prev,
          [filePath]: res.data,
        }));
      }
    } catch (err) {
      console.error("Failed to load symbols for file:", filePath, err);
    }
  }, [symbolsMap]);

  const fetchGraphAndSymbols = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Dependency Graph
      const graphRes = await commands.getDependencyGraph(projectId);
      if (graphRes.status === "error") {
        throw new Error(graphRes.error);
      }
      setRawGraph(graphRes.data);

      // 2. Compute left-to-right layer layout
      const dbNodes = graphRes.data.nodes;
      const dbEdges = graphRes.data.edges;

      // Calculate Degrees
      const inDegree: Record<string, number> = {};
      dbNodes.forEach((n) => {
        inDegree[String(n.file_id)] = 0;
      });
      dbEdges.forEach((e) => {
        inDegree[String(e.target_file_id)] = (inDegree[String(e.target_file_id)] || 0) + 1;
      });

      // Layer assignment logic (topological ordering simulation)
      const layers: Record<string, number> = {};
      let currentNodes = dbNodes.map((n) => String(n.file_id));
      let currentLayer = 0;

      while (currentNodes.length > 0) {
        const nextNodes: string[] = [];
        currentNodes.forEach((id) => {
          const hasIncomingFromRemaining = dbEdges.some(
            (e) => String(e.target_file_id) === id && currentNodes.includes(String(e.source_file_id))
          );
          if (!hasIncomingFromRemaining) {
            layers[id] = currentLayer;
          } else {
            nextNodes.push(id);
          }
        });

        // Loop breaker for cycles
        if (nextNodes.length === currentNodes.length) {
          currentNodes.forEach((id) => {
            layers[id] = currentLayer;
          });
          break;
        }
        currentNodes = nextNodes;
        currentLayer++;
      }

      // Group nodes by layer for y-position layout
      const nodesByLayer: Record<number, string[]> = {};
      Object.entries(layers).forEach(([id, l]) => {
        if (!nodesByLayer[l]) {
          nodesByLayer[l] = [];
        }
        nodesByLayer[l].push(id);
      });

      // Map DB Nodes to ReactFlow Nodes
      const rfNodes: Node[] = dbNodes.map((node) => {
        const nodeIdStr = String(node.file_id);
        const layer = layers[nodeIdStr] || 0;
        const indexInLayer = nodesByLayer[layer].indexOf(nodeIdStr);
        
        // Dynamic positioning coordinates
        const x = layer * 320 + 50;
        const y = indexInLayer * 160 + 50;

        return {
          id: nodeIdStr,
          type: "custom",
          data: {
            file_path: node.path,
            language: node.language,
            isSelected: false,
          },
          position: { x, y },
        };
      });

      // Map DB Edges to ReactFlow Edges
      const rfEdges: Edge[] = dbEdges.map((edge, index) => ({
        id: `e-${index}`,
        source: String(edge.source_file_id),
        target: String(edge.target_file_id),
        type: "smoothstep",
        animated: true,
        style: { stroke: "#6366f1", strokeWidth: 1.5, opacity: 0.6 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: "#6366f1",
        },
      }));

      setNodes(rfNodes);
      setEdges(rfEdges);

      // Auto center the view if elements exist
      if (rfNodes.length > 0) {
        setTimeout(() => {
          setCenter(150, 150, { zoom: 0.8, duration: 400 });
        }, 100);
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to load dependency graph.");
    } finally {
      setLoading(false);
    }
  }, [projectId, setCenter, setNodes, setEdges]);

  useEffect(() => {
    fetchGraphAndSymbols();
  }, [fetchGraphAndSymbols]);

  // Handle Node selection
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const path = (node.data as unknown as CustomNodeData).file_path;
      setSelectedFilePath(path);
      fetchSymbolsForFile(Number(node.id), path);

      // Highlight selected node
      setNodes((prevNodes: Node[]) =>
        prevNodes.map((n) => ({
          ...n,
          data: {
            ...(n.data as unknown as CustomNodeData),
            isSelected: n.id === node.id,
          },
        }))
      );
    },
    [setNodes, fetchSymbolsForFile]
  );

  // Search highlight
  const executeSearch = () => {
    if (!searchQuery.trim()) return;
    const matchedNode = nodes.find((n) =>
      ((n.data as unknown as CustomNodeData).file_path).toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (matchedNode) {
      const path = (matchedNode.data as unknown as CustomNodeData).file_path;
      setSelectedFilePath(path);
      fetchSymbolsForFile(Number(matchedNode.id), path);
      
      // Update selected state in flow
      setNodes((prevNodes: Node[]) =>
        prevNodes.map((n) => ({
          ...n,
          data: {
            ...(n.data as unknown as CustomNodeData),
            isSelected: n.id === matchedNode.id,
          },
        }))
      );

      // Recenter camera
      setCenter(matchedNode.position.x + 110, matchedNode.position.y + 40, {
        zoom: 1.1,
        duration: 700,
      });
    }
  };

  // Select a file from links (incoming/outgoing list)
  const selectFileByPath = useCallback((path: string) => {
    const matchedNode = nodes.find((n) => (n.data as unknown as CustomNodeData).file_path === path);
    if (matchedNode) {
      setSelectedFilePath(path);
      fetchSymbolsForFile(Number(matchedNode.id), path);
      setNodes((prevNodes: Node[]) =>
        prevNodes.map((n) => ({
          ...n,
          data: {
            ...(n.data as unknown as CustomNodeData),
            isSelected: n.id === matchedNode.id,
          },
        }))
      );
      setCenter(matchedNode.position.x + 110, matchedNode.position.y + 40, {
        zoom: 1.1,
        duration: 700,
      });
    }
  }, [nodes, setNodes, setCenter, fetchSymbolsForFile]);

  // Inspector dependencies calculation
  const inspectorDeps = useMemo(() => {
    if (!selectedFilePath || !rawGraph) return { incoming: [], outgoing: [] };

    const selectedNode = rawGraph.nodes.find(n => n.path === selectedFilePath);
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

  return (
    <div className="flex h-[calc(100vh-160px)] relative overflow-hidden bg-zinc-950/40 rounded-xl border border-zinc-800/80">
      {/* Left side: Canvas and Search */}
      <div className="flex-1 flex flex-col relative h-full">
        {/* Controls Header */}
        <div className="absolute top-4 left-4 z-10 flex gap-2 max-w-lg bg-zinc-950/80 p-2 rounded-xl border border-zinc-800/60 backdrop-blur-md">
          <div className="relative">
            <Input
              type="text"
              placeholder="Search file path..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && executeSearch()}
              className="w-64 h-9 bg-zinc-900 border-zinc-800 text-zinc-100 placeholder-zinc-500 focus-visible:ring-violet-500"
            />
            <Search className="absolute right-3 top-2.5 w-4 h-4 text-zinc-500" />
          </div>
          <Button
            size="sm"
            onClick={executeSearch}
            className="bg-violet-600 hover:bg-violet-700 text-zinc-100 h-9"
          >
            Find
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchGraphAndSymbols}
            disabled={loading}
            className="border-zinc-800 hover:bg-zinc-800 text-zinc-400 h-9 w-9"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {error && (
          <div className="absolute top-20 left-4 z-10 bg-red-950/80 border border-red-800/40 text-red-300 px-4 py-2.5 rounded-lg max-w-md text-xs backdrop-blur-sm">
            {error}
          </div>
        )}

        {/* Canvas */}
        <div className="w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            minZoom={0.2}
            maxZoom={2.5}
            fitViewOptions={{ padding: 0.15 }}
          >
            <Background color="#27272a" gap={24} size={1} />
            <Controls className="bg-zinc-900 border-zinc-800 text-zinc-400 rounded-lg overflow-hidden [&_button]:border-zinc-800 [&_button]:hover:bg-zinc-800 [&_path]:fill-zinc-400" />
            <MiniMap
              nodeColor="#1e1b4b"
              maskColor="rgba(9, 9, 11, 0.7)"
              className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden"
              style={{ height: 120, width: 170 }}
            />
          </ReactFlow>
        </div>
      </div>

      {/* Right side: Slide-over symbols and dependencies inspector */}
      {selectedFilePath && (
        <div className="w-96 border-l border-zinc-800 bg-zinc-950/95 backdrop-blur-xl h-full flex flex-col z-20 shadow-2xl animate-in slide-in-from-right duration-300">
          {/* Side panel Header */}
          <div className="p-4 border-b border-zinc-800 flex justify-between items-start gap-4">
            <div className="overflow-hidden">
              <span className="text-[10px] text-zinc-500 font-mono block truncate">
                {selectedFilePath.split("/").slice(0, -1).join("/") || "./"}
              </span>
              <h3 className="text-sm font-bold text-zinc-100 truncate" title={selectedFilePath.split("/").pop() || ""}>
                {selectedFilePath.split("/").pop()}
              </h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectedFilePath(null);
                setNodes((ns: Node[]) => ns.map((n) => ({
                  ...n,
                  data: {
                    ...(n.data as unknown as CustomNodeData),
                    isSelected: false,
                  },
                })));
              }}
              className="text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Side Panel Tabs/Content */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 scrollbar-thin">
            {/* Connections Section */}
            <div>
              <h4 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-indigo-400" /> Connections
              </h4>
              <div className="flex flex-col gap-4">
                {/* Incoming imports */}
                <div>
                  <span className="text-[10px] text-zinc-500 block mb-1">Imported by ({inspectorDeps.incoming.length}):</span>
                  {inspectorDeps.incoming.length > 0 ? (
                    <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-1">
                      {inspectorDeps.incoming.map((path) => (
                        <button
                          key={path}
                          onClick={() => selectFileByPath(path)}
                          className="flex items-center justify-between text-left text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white px-2.5 py-1.5 rounded border border-zinc-800/80 transition-colors w-full group"
                        >
                          <span className="truncate flex-1 font-mono text-[11px]">
                            {path.split("/").pop()}
                          </span>
                          <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-zinc-300 ml-1.5 flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-600 block italic pl-2">No incoming imports.</span>
                  )}
                </div>

                {/* Outgoing imports */}
                <div>
                  <span className="text-[10px] text-zinc-500 block mb-1">Imports ({inspectorDeps.outgoing.length}):</span>
                  {inspectorDeps.outgoing.length > 0 ? (
                    <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-1">
                      {inspectorDeps.outgoing.map((path) => (
                        <button
                          key={path}
                          onClick={() => selectFileByPath(path)}
                          className="flex items-center justify-between text-left text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white px-2.5 py-1.5 rounded border border-zinc-800/80 transition-colors w-full group"
                        >
                          <span className="truncate flex-1 font-mono text-[11px]">
                            {path.split("/").pop()}
                          </span>
                          <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-zinc-300 ml-1.5 flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-600 block italic pl-2">No outgoing imports.</span>
                  )}
                </div>
              </div>
            </div>

            {/* AST Symbol Definitions Section */}
            <div>
              <h4 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-emerald-400" /> Symbols ({selectedFileSymbols.length})
              </h4>
              {selectedFileSymbols.length > 0 ? (
                <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto pr-1">
                  {selectedFileSymbols.map((sym, i) => {
                    let typeBadge = "bg-zinc-900 text-zinc-500 border-zinc-800";
                    if (["function", "method"].includes(sym.kind)) {
                      typeBadge = "bg-teal-950/40 text-teal-300 border border-teal-900/55";
                    } else if (["struct", "class", "interface"].includes(sym.kind)) {
                      typeBadge = "bg-violet-950/40 text-violet-300 border border-violet-900/55";
                    } else if (["enum", "trait", "type"].includes(sym.kind)) {
                      typeBadge = "bg-amber-950/40 text-amber-300 border border-amber-900/55";
                    }

                    return (
                      <div
                        key={`${sym.name}-${i}`}
                        className="flex items-center justify-between text-xs bg-zinc-900/40 px-3 py-2 rounded-lg border border-zinc-900/80 hover:border-zinc-800 transition-colors"
                      >
                        <div className="overflow-hidden mr-2">
                          <span className="font-semibold text-zinc-200 font-mono truncate block" title={sym.name}>
                            {sym.name}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            Lines {sym.start_line} - {sym.end_line}
                          </span>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold font-mono tracking-wider ${typeBadge}`}>
                          {sym.kind}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className="text-xs text-zinc-600 block italic pl-2">No symbols indexed in this file.</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DependencyGraphView({ projectId }: { projectId: number }) {
  return (
    <ReactFlowProvider>
      <DependencyGraphInner projectId={projectId} />
    </ReactFlowProvider>
  );
}
