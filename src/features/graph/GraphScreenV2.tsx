// Code Map (의존성 그래프) — ui_v2 screen, PR-GR0~2.
// Renders the multi-relation code graph (commands.getCodeGraph). Two grouping
// modes — 폴더 (default: aggregate files into folder nodes so large projects
// stay readable) and 파일. Edges are typed (import / 호출 / 상속 / 구현) with
// per-type filters + colors; estimated (name-matched) edges render dashed.
//
// Readability redesign (2026-06-17):
//   • importance — node size encodes centrality (degree); hubs read as big.
//   • LOD        — nodes simplify to label pills when zoomed out so a large
//                  graph stays legible instead of a wall of identical cards.
//   • focus      — selecting a node can cull the canvas to its neighbourhood
//                  (toggle) instead of only dimming, killing the hairball.
//   • inspector  — impact/role-centric, with open-in-editor + code peek.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  MarkerType,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Toolbar } from "@/components/Toolbar";
import { SearchIcon, RefreshCw, FileCode2, Target } from "@/components/Icons";
import { commands, type SymbolDef, type SymbolCall } from "@/lib/bindings";
import { useSettings } from "@/contexts/SettingsContext";
import { OculSpinner } from "@/components/OculSpinner";
import { FileNode, type GraphNodeData, type Lod } from "./FileNode";
import { FloatingEdge } from "./FloatingEdge";
import { GraphInspector } from "./GraphInspector";
import { dagreLayout, forceLayout, sizeForDegree, type NodeSize } from "./layout";
import { langColor } from "./palette";
import {
  EDGE_META,
  EDGE_ORDER,
  baseName,
  dirOf,
  lastSeg,
  dirCrumb,
  type FileRow,
  type FileEdge,
  type GNode,
  type GEdge,
  type NeighborRel,
} from "./types";
import { useT, type I18nKey } from "@/i18n";
import "./graph.css";

const nodeTypes = { fileNode: FileNode };
// 플로팅 엣지 — 노드 경계 교차점끼리 최단 방향으로 잇는다 (헤어볼 해소의 핵심).
const edgeTypes = { floating: FloatingEdge };
type Mode = "dir" | "file";
// 계층 = dagre / 유기형 = force spread / 묶음 = force + Louvain 클러스터
type Layout = "dagre" | "force" | "cluster";
const LAYOUTS: { id: Layout; labelKey: I18nKey; titleKey: I18nKey }[] = [
  { id: "dagre", labelKey: "graph.layout.dagre", titleKey: "graph.layout.dagreTitle" },
  { id: "force", labelKey: "graph.layout.force", titleKey: "graph.layout.forceTitle" },
  { id: "cluster", labelKey: "graph.layout.cluster", titleKey: "graph.layout.clusterTitle" },
];

// Zoom → level of detail. Below `far` we draw label pills; above `near`, full
// cards. Tuned so a fit-to-view of a large graph lands in "far".
function lodForZoom(z: number): Lod {
  if (z < 0.42) return "far";
  if (z < 0.8) return "mid";
  return "near";
}

// Minimal surface of the React Flow instance we capture via onInit — just the
// imperative fitView used to frame a focused subgraph.
type FlowApi = {
  fitView: (opts?: { nodes?: { id: string }[]; padding?: number; maxZoom?: number; duration?: number }) => void;
};

export function GraphScreenV2({
  projectId,
  projectRoot,
  onOpenInCode,
}: {
  projectId: number;
  projectRoot: string | null;
  /** 파일 노드를 인앱 코드 화면으로 여는 핸드오프 (ShellV2 가 내려준다). */
  onOpenInCode?: (path: string, line: number | null) => void;
}) {
  const { t } = useT();
  const { settings } = useSettings();
  const [graph, setGraph] = useState<{ nodes: FileRow[]; edges: FileEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  // 감사 fix (2026-07-16): 백엔드 실패를 "관계 없음" 빈 상태로 삼키지 않는다.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("dir");
  const [layout, setLayout] = useState<Layout>("dagre");
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(["imports"]));
  const [selected, setSelected] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<SymbolDef[] | null>(null);
  const [calls, setCalls] = useState<SymbolCall[] | null>(null);
  // Readability redesign state
  const [focusMode, setFocusMode] = useState(true);
  const [lod, setLod] = useState<Lod>("near");
  // 대규모 가독성 (2026-07-16): 기본은 연결 차수 상위 N 노드만 — showAll 로 해제.
  const [showAll, setShowAll] = useState(false);
  // 호버 하이라이트 — 클릭 없이 이웃 관계를 미리 본다.
  const [hovered, setHovered] = useState<string | null>(null);
  const flowRef = useRef<FlowApi | null>(null);
  // Deferred so typing in the path filter never blocks on the (cheap) re-filter
  // — and, crucially, the layout no longer recomputes per keystroke (see below).
  const deferredQuery = useDeferredValue(query);

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(null);
    setHovered(null);
    setShowAll(false);
    setLoadError(null);
    const res = await commands.getCodeGraph(projectId, { symbol_level: false });
    if (res.status === "ok") {
      const code = res.data;
      const nodeFile = new Map(code.nodes.map((n) => [n.id, n.file_id]));
      setGraph({
        nodes: code.nodes
          .filter((n) => n.kind === "file")
          .map((n) => ({ fileId: n.file_id, path: n.file_path, language: n.language })),
        edges: code.edges
          .map((e) => ({
            source: nodeFile.get(e.source),
            target: nodeFile.get(e.target),
            type: e.edge_type,
            estimated: e.estimated,
          }))
          .filter((e): e is FileEdge => e.source != null && e.target != null),
      });
    } else {
      setGraph({ nodes: [], edges: [] });
      setLoadError(res.error);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const fileById = useMemo(() => {
    const m = new Map<number, FileRow>();
    graph?.nodes.forEach((n) => m.set(n.fileId, n));
    return m;
  }, [graph]);

  // Edge types actually present in the data (for the filter chips).
  const presentTypes = useMemo(() => {
    const s = new Set<string>();
    graph?.edges.forEach((e) => s.add(e.type));
    return EDGE_ORDER.filter((t) => s.has(t));
  }, [graph]);

  // Heavy stage — build mode nodes/edges, compute degrees + importance sizes,
  // and run the layout. Deliberately independent of the search query so typing
  // never re-runs the (expensive) layout; recomputes only when the graph
  // structure / mode / layout / edge filters change.
  const laidOut = useMemo(() => {
    const empty = {
      nodes: [] as GNode[],
      edges: [] as GEdge[],
      pos: new Map<string, { x: number; y: number }>(),
      map: new Map<string, GNode>(),
      sizes: new Map<string, NodeSize>(),
      all: [] as GNode[],
      total: 0,
      capped: false,
    };
    if (!graph) return empty;
    const edges = graph.edges.filter((e) => enabled.has(e.type) && e.source !== e.target);

    let nodes: GNode[] = [];
    let gedges: GEdge[] = [];

    if (mode === "file") {
      nodes = graph.nodes.map((n) => ({
        id: `f${n.fileId}`,
        kind: "file",
        label: baseName(n.path),
        sub: dirCrumb(n.path),
        path: n.path,
        language: n.language,
        fileIds: [n.fileId],
        inCount: 0,
        outCount: 0,
      }));
      // 같은 (타입, 소스, 타깃) 엣지는 weight 로 합친다 — 중복 DOM 패스와
      // 겹쳐 그리는 잉크를 없애고, id 도 자연히 유일해진다.
      const fileAgg = new Map<string, GEdge>();
      edges.forEach((e) => {
        const k = `${e.type}|f${e.source}|f${e.target}`;
        const cur = fileAgg.get(k);
        if (cur) {
          cur.weight += 1;
          cur.estimated = cur.estimated && e.estimated;
        } else {
          fileAgg.set(k, {
            source: `f${e.source}`,
            target: `f${e.target}`,
            type: e.type,
            estimated: e.estimated,
            weight: 1,
          });
        }
      });
      gedges = [...fileAgg.values()];
    } else {
      const dirs = new Map<string, FileRow[]>();
      graph.nodes.forEach((n) => {
        const d = dirOf(n.path);
        (dirs.get(d) ?? dirs.set(d, []).get(d)!).push(n);
      });
      const fileDir = new Map<number, string>();
      graph.nodes.forEach((n) => fileDir.set(n.fileId, dirOf(n.path)));
      const agg = new Map<string, { type: string; src: string; tgt: string; n: number; est: boolean }>();
      edges.forEach((e) => {
        const s = fileDir.get(e.source);
        const t = fileDir.get(e.target);
        if (s == null || t == null || s === t) return;
        const k = `${e.type} ${s} ${t}`;
        const cur = agg.get(k);
        if (cur) {
          cur.n += 1;
          cur.est = cur.est && e.estimated;
        } else {
          agg.set(k, { type: e.type, src: s, tgt: t, n: 1, est: e.estimated });
        }
      });
      nodes = [...dirs.entries()].map(([dir, files]) => {
        const counts = new Map<string, number>();
        files.forEach((f) => {
          if (f.language) counts.set(f.language, (counts.get(f.language) ?? 0) + 1);
        });
        let dom: string | null = null;
        let best = 0;
        counts.forEach((c, l) => {
          if (c > best) {
            best = c;
            dom = l;
          }
        });
        // 언어 구성 미니 바 — 상위 3 언어 + 기타 (near LOD 의 폴더 카드 하단).
        const top = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([l, c]) => ({ color: langColor(l), ratio: c / files.length }));
        const rest = 1 - top.reduce((s, m) => s + m.ratio, 0);
        const langMix = rest > 0.02 ? [...top, { color: "var(--text-3)", ratio: rest }] : top;
        return {
          id: `d:${dir}`,
          kind: "dir" as const,
          label: lastSeg(dir),
          sub: dir,
          path: dir,
          language: dom,
          fileIds: files.map((f) => f.fileId),
          inCount: 0,
          outCount: 0,
          langMix,
        };
      });
      gedges = [...agg.values()].map((a) => ({
        source: `d:${a.src}`,
        target: `d:${a.tgt}`,
        type: a.type,
        estimated: a.est,
        weight: a.n,
      }));
    }

    // degrees
    const inC = new Map<string, number>();
    const outC = new Map<string, number>();
    gedges.forEach((e) => {
      outC.set(e.source, (outC.get(e.source) ?? 0) + 1);
      inC.set(e.target, (inC.get(e.target) ?? 0) + 1);
    });
    nodes.forEach((n) => {
      n.inCount = inC.get(n.id) ?? 0;
      n.outCount = outC.get(n.id) ?? 0;
    });

    // isolated filter (stable — the search query is applied cheaply downstream).
    const keptAll = settings.graphShowIsolated ? nodes : nodes.filter((n) => n.inCount + n.outCount > 0);
    // 대규모 가독성 — 기본은 중요(연결 차수) 상위 N 만 그린다. 큰 저장소를 열어도
    // 첫 화면이 '핵심 지도'로 읽히고, 전체는 툴바 칩으로 옵트인.
    const CAP = mode === "file" ? 160 : 240;
    const capped = !showAll && keptAll.length > CAP;
    const kept = capped
      ? [...keptAll]
          .sort(
            (a, b) =>
              b.inCount + b.outCount - (a.inCount + a.outCount) || a.path.localeCompare(b.path),
          )
          .slice(0, CAP)
      : keptAll;
    const vis = new Set(kept.map((n) => n.id));
    const fedges = gedges.filter((e) => vis.has(e.source) && vis.has(e.target));
    const ids = kept.map((n) => n.id);
    // Importance-scaled sizes feed both the layout (so big nodes don't overlap)
    // and the rendered node.
    const sizes = new Map<string, NodeSize>();
    kept.forEach((n) => sizes.set(n.id, sizeForDegree(n.inCount + n.outCount)));
    const pos =
      layout === "dagre"
        ? dagreLayout(ids, fedges, sizes)
        : forceLayout(ids, fedges, layout === "cluster", sizes);
    const map = new Map(kept.map((n) => [n.id, n]));
    // `all` = 캡 적용 전 전체 — 검색이 컷된 노드도 찾을 수 있게 노출한다.
    return { nodes: kept, edges: fedges, pos, map, sizes, all: keptAll, total: keptAll.length, capped };
  }, [graph, mode, layout, enabled, showAll, settings.graphShowIsolated]);

  // Light stage — apply the path-search filter to the already-laid-out graph. No
  // layout work, so search stays responsive even on large graphs.
  const built = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) {
      return {
        visible: laidOut.nodes,
        edges: laidOut.edges,
        pos: laidOut.pos,
        map: laidOut.map,
        sizes: laidOut.sizes,
        total: laidOut.total,
        capped: laidOut.capped,
      };
    }
    const visible = laidOut.nodes.filter((n) => n.path.toLowerCase().includes(q));
    const vis = new Set(visible.map((n) => n.id));
    const edges = laidOut.edges.filter((e) => vis.has(e.source) && vis.has(e.target));
    return {
      visible,
      edges,
      pos: laidOut.pos,
      map: laidOut.map,
      sizes: laidOut.sizes,
      total: laidOut.total,
      capped: laidOut.capped,
    };
  }, [laidOut, deferredQuery]);

  // Hub threshold — top-tier degree (p85, min 4). Drives the inspector's role
  // label + the node accent so "허브" means hub relative to THIS graph.
  const hubThreshold = useMemo(() => {
    const degs = laidOut.nodes
      .map((n) => n.inCount + n.outCount)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    if (degs.length === 0) return 4;
    const p85 = degs[Math.min(degs.length - 1, Math.floor(degs.length * 0.85))];
    return Math.max(4, p85);
  }, [laidOut.nodes]);

  // 인접 사전 — 선택/호버 이웃 계산이 전 엣지 순회 대신 O(1) 조회가 되도록
  // 그래프 구조가 바뀔 때 한 번만 만든다. 검색 필터와 무관한 **구조적** 인접
  // (laidOut 기준)이라, 포커스 이웃이 검색어에 오염되지 않는다.
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    laidOut.edges.forEach((e) => {
      (m.get(e.source) ?? m.set(e.source, new Set()).get(e.source)!).add(e.target);
      (m.get(e.target) ?? m.set(e.target, new Set()).get(e.target)!).add(e.source);
    });
    return m;
  }, [laidOut.edges]);

  const connected = useMemo(() => {
    if (selected == null) return null;
    return new Set<string>([selected, ...(adjacency.get(selected) ?? [])]);
  }, [selected, adjacency]);

  // 호버 이웃 — 선택 없이도 관계를 미리 본다. 선택 중이거나 노드가 아주 많을
  // 땐(호버마다 전 노드 리렌더 비용) 비활성.
  const HOVER_LIMIT = 400;
  const hoverSet = useMemo(() => {
    if (hovered == null || selected != null) return null;
    if (built.visible.length > HOVER_LIMIT) return null;
    return new Set<string>([hovered, ...(adjacency.get(hovered) ?? [])]);
  }, [hovered, selected, built.visible.length, adjacency]);

  // Focus active = a node is selected AND focus culling is on → render only the
  // neighbourhood. Positions are kept (no relayout) so spatial memory survives.
  const focusActive = focusMode && selected != null && connected != null;

  // When focus activates (or the focused node changes), frame the neighbourhood
  // so the kept-position neighbours aren't left scattered off-screen. Deferred a
  // tick so React Flow has the culled node set before fitView reads positions.
  useEffect(() => {
    if (!focusActive || !connected || !flowRef.current) return;
    const nodes = [...connected].map((id) => ({ id }));
    const t = setTimeout(() => {
      flowRef.current?.fitView({ nodes, padding: 0.3, maxZoom: 1.2, duration: 320 });
    }, 30);
    return () => clearTimeout(t);
  }, [focusActive, connected]);

  const displayNodes = useMemo<Node[]>(() => {
    // 포커스는 **구조적** 이웃 전체를 보여준다 — 검색 필터가 이웃을 반쯤
    // 숨겨 "혼자 뜬 노드"가 되던 문제(검색 Enter → 포커스 조합)의 수정.
    const src = focusActive
      ? laidOut.nodes.filter((n) => connected!.has(n.id))
      : built.visible;
    return src
      .map((n) => {
        const size = built.sizes.get(n.id) ?? sizeForDegree(n.inCount + n.outCount);
        const deg = n.inCount + n.outCount;
        return {
          id: n.id,
          type: "fileNode",
          position: built.pos.get(n.id) ?? { x: 0, y: 0 },
          // Explicit dims so React Flow (and the MiniMap) know every node's size
          // even when it's culled by onlyRenderVisibleElements — without these
          // the MiniMap can't compute bounds and renders blank.
          width: size.w,
          height: size.h,
          data: {
            kind: n.kind,
            label: n.label,
            sub: n.sub,
            language: n.language,
            color: langColor(n.language),
            fileCount: n.fileIds.length,
            inCount: n.inCount,
            outCount: n.outCount,
            selected: selected === n.id,
            // Don't dim inside focus mode — everything shown is relevant.
            // 선택 시엔 hard(강한 감쇠), 호버 시엔 soft(가벼운 감쇠).
            dim:
              focusActive || (connected == null && hoverSet == null)
                ? ("none" as const)
                : connected != null
                  ? connected.has(n.id)
                    ? ("none" as const)
                    : ("hard" as const)
                  : hoverSet!.has(n.id)
                    ? ("none" as const)
                    : ("soft" as const),
            w: size.w,
            h: size.h,
            tier: size.tier,
            // Focus view is sparse → always show full detail regardless of zoom.
            lod: focusActive ? "near" : lod,
            hub: deg >= hubThreshold,
            langMix: n.langMix,
          } satisfies GraphNodeData as unknown as Record<string, unknown>,
        };
      });
  }, [laidOut.nodes, built.visible, built.pos, built.sizes, selected, connected, hoverSet, focusActive, lod, hubThreshold]);

  // 초대형 그래프 엣지 상한 — 가중치 상위만 상시 표시하고, 선택/호버 인접
  // 엣지는 언제나 살린다 (헤어볼의 잉크량 자체를 줄이는 안전판).
  const EDGE_CAP = 1400;
  const edgeKeep = useMemo(() => {
    if (built.edges.length <= EDGE_CAP) return null;
    return new Set([...built.edges].sort((a, b) => b.weight - a.weight).slice(0, EDGE_CAP));
  }, [built.edges]);

  const displayEdges = useMemo<Edge[]>(() => {
    const hot = selected ?? hovered;
    // 줌 아웃할수록 엣지 잉크를 줄인다 — far 에선 노드 라벨이 주인공.
    const baseOpacity = lod === "far" ? 0.32 : lod === "mid" ? 0.55 : 0.72;
    // 포커스는 구조적 엣지에서 (검색 필터 무시), 평상시는 필터된 엣지에서.
    const list = focusActive
      ? laidOut.edges.filter((e) => e.source === selected || e.target === selected)
      : built.edges;
    return list
      .filter(
        (e) =>
          edgeKeep == null ||
          edgeKeep.has(e) ||
          (hot != null && (e.source === hot || e.target === hot)),
      )
      .map((e) => {
        const active = hot != null && (e.source === hot || e.target === hot);
        // 포커스 안에선 전부 인접 엣지 — 액센트로 통일하는 대신 타입 색을
        // 유지해 관계 종류가 읽히게 한다. 강조(액센트+애니메이션)는 평상시
        // 호버/선택에만.
        const emphasize = active && !focusActive;
        const base = EDGE_META[e.type]?.color ?? "#8b93a1";
        const dimHard = !focusActive && connected != null && !active;
        const dimSoft = !dimHard && hoverSet != null && !active;
        return {
          // 안정 id (타입|소스|타깃) — 필터 토글 때 인덱스가 밀리며 전체 엣지
          // DOM 이 재생성되던 것을 막는다. dedupe 후라 유일성이 보장된다.
          id: `${e.type}|${e.source}|${e.target}`,
          source: e.source,
          target: e.target,
          type: "floating",
          animated: emphasize,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 13,
            height: 13,
            color: base,
          },
          style: {
            stroke: emphasize ? "var(--accent)" : base,
            strokeWidth: emphasize
              ? 2.2
              : Math.min(3, (focusActive ? 1.4 : 1.2) + Math.log2(e.weight)),
            strokeDasharray: e.estimated ? "5 3" : undefined,
            opacity: dimHard
              ? 0.05
              : dimSoft
                ? 0.1
                : emphasize
                  ? 0.95
                  : focusActive
                    ? 0.85
                    : e.estimated
                      ? baseOpacity * 0.75
                      : baseOpacity,
          },
        };
      });
  }, [laidOut.edges, built.edges, edgeKeep, connected, hoverSet, selected, hovered, focusActive, lod]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelected((prev) => (prev === node.id ? null : node.id));
  }, []);

  const onNodeHover: NodeMouseHandler = useCallback((_, node) => setHovered(node.id), []);
  const onNodeHoverEnd = useCallback(() => setHovered(null), []);

  // 폴더 더블클릭 → 파일 모드로 그 폴더만 드릴다운 (경로 필터 재사용).
  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_, node) => {
      const g = built.map.get(node.id);
      if (!g || g.kind !== "dir") return;
      setMode("file");
      setSelected(null);
      setHovered(null);
      setShowAll(false);
      setQuery(g.path ? `${g.path}/` : "");
    },
    [built.map],
  );

  // 검색 Enter — 가장 그럴듯한 매치(이름 시작 > 중심성)를 선택 + 프레이밍.
  // deferredQuery 가 아니라 현재 query 로 직접 거른다 (Enter 시점 지연 회피).
  // 후보는 캡 적용 **전** 전체(laidOut.all)에서 찾는다 — 예전엔 상위 N 에서
  // 잘린 노드를 고르면 존재하지 않는 id 가 선택돼 포커스가 빈 화면이 됐다.
  const focusFirstMatch = useCallback(() => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const pool = laidOut.all.filter((n) => n.path.toLowerCase().includes(q));
    if (pool.length === 0) return;
    pool.sort(
      (a, b) =>
        Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)) ||
        b.inCount + b.outCount - (a.inCount + a.outCount),
    );
    const id = pool[0].id;
    // 컷된 노드면 전체 표시로 승격해 실제로 화면에 존재하게 만든다.
    if (!laidOut.map.has(id)) setShowAll(true);
    setSelected(id);
    if (!focusMode) {
      window.setTimeout(() => {
        flowRef.current?.fitView({ nodes: [{ id }], padding: 0.4, maxZoom: 1.15, duration: 300 });
      }, 30);
    }
  }, [query, laidOut.all, laidOut.map, focusMode]);

  const onMove = useCallback((_: unknown, vp: Viewport) => {
    const next = lodForZoom(vp.zoom);
    setLod((prev) => (prev === next ? prev : next));
  }, []);

  const toggleType = useCallback((t: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  useEffect(() => {
    if (selected == null || !selected.startsWith("f")) {
      setSymbols(null);
      setCalls(null);
      return;
    }
    const fileId = Number(selected.slice(1));
    let alive = true;
    void commands.getFileSymbols(fileId).then((res) => {
      if (alive) setSymbols(res.status === "ok" ? res.data : []);
    });
    // GR3 — symbol-level calls ("which function calls which") for the inspector.
    void commands.getFileCalls(fileId).then((res) => {
      if (alive) setCalls(res.status === "ok" ? res.data : []);
    });
    return () => {
      alive = false;
    };
  }, [selected]);

  // Resolved intra-project calls grouped by caller symbol (top-level last).
  const callGroups = useMemo(() => {
    if (!calls) return [];
    const byFrom = new Map<string, SymbolCall[]>();
    for (const c of calls) {
      if (!c.target_path) continue; // skip external/unresolved
      const key = c.from_symbol ?? "";
      (byFrom.get(key) ?? byFrom.set(key, []).get(key)!).push(c);
    }
    return [...byFrom.entries()]
      .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])))
      .map(([from, list]) => ({ from, list }));
  }, [calls]);

  const sel = selected != null ? built.map.get(selected) : null;

  // Neighbours of the selected node, collapsed across edge types (one row per
  // related node, carrying the relation kinds + estimated flag).
  const neighbors = useMemo(() => {
    if (!sel) return { out: [] as NeighborRel[], incoming: [] as NeighborRel[] };
    const collect = (pickKey: (e: GEdge) => string | null) => {
      const m = new Map<string, NeighborRel>();
      // 구조적 엣지(laidOut) 기준 — 인스펙터 이웃 목록이 검색어에 잘리지 않는다.
      for (const e of laidOut.edges) {
        const otherId = pickKey(e);
        if (otherId == null) continue;
        const other = built.map.get(otherId);
        if (!other) continue;
        const cur = m.get(otherId);
        if (cur) {
          if (!cur.types.includes(e.type)) cur.types.push(e.type);
          cur.estimated = cur.estimated && e.estimated;
        } else {
          m.set(otherId, { node: other, types: [e.type], estimated: e.estimated });
        }
      }
      return [...m.values()]
        .map((r) => ({ ...r, types: EDGE_ORDER.filter((t) => r.types.includes(t)) }))
        .sort((a, b) => b.node.inCount + b.node.outCount - (a.node.inCount + a.node.outCount));
    };
    return {
      out: collect((e) => (e.source === sel.id ? e.target : null)),
      incoming: collect((e) => (e.target === sel.id ? e.source : null)),
    };
  }, [sel, laidOut.edges, built.map]);

  const legend = useMemo(() => {
    const set = new Map<string, string>();
    laidOut.nodes.forEach((n) => {
      if (n.language) set.set(n.language, langColor(n.language));
    });
    return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 10);
  }, [laidOut.nodes]);

  const unit = mode === "dir" ? t("graph.unitDir") : t("graph.unitFile");

  return (
    <div className="flex flex-col h-full">
      <Toolbar
        title={t("nav.graph")}
        sub={t("graph.toolbarSub", { n: built.visible.length, cap: built.capped ? ` / ${built.total}` : "", unit, edges: built.edges.length, focus: focusActive ? t("graph.focusSuffix") : "" })}
      >
        <div className="gr-seg" role="group" aria-label={t("graph.groupAria")}>
          {(["dir", "file"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setSelected(null);
                setShowAll(false);
              }}
              className={mode === m ? "on" : ""}
            >
              {m === "dir" ? t("graph.unitDir") : t("graph.unitFile")}
            </button>
          ))}
        </div>
        <div className="gr-seg" role="group" aria-label={t("graph.layoutAria")}>
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLayout(l.id)}
              title={t(l.titleKey)}
              className={layout === l.id ? "on" : ""}
            >
              {t(l.labelKey)}
            </button>
          ))}
        </div>
        {/* 상위 N 추림 상태 — 클릭으로 전체/핵심 토글. */}
        {built.capped || showAll ? (
          <button
            onClick={() => setShowAll((v) => !v)}
            title={
              showAll
                ? t("graph.showCore")
                : t("graph.showAllTitle", { n: built.total })
            }
            className={`gr-chip${showAll ? " on" : ""}`}
          >
            {showAll ? t("graph.showAll", { n: built.total }) : t("graph.showCoreCount", { n: built.visible.length, total: built.total })}
          </button>
        ) : null}
        {/* Focus toggle — selecting a node culls to its neighbourhood. */}
        <button
          onClick={() => setFocusMode((v) => !v)}
          title={t("graph.focusTitle")}
          className={`gr-chip${focusMode ? " on" : ""}`}
        >
          <Target size={13} /> {t("graph.focus")}
        </button>
        {presentTypes.length > 1 ? (
          <div className="flex items-center gap-1">
            {/* 콜백 인자를 `t` 로 두면 번역 함수를 섀도잉한다 — `et`(edge type). */}
            {presentTypes.map((et) => {
              const on = enabled.has(et);
              return (
                <button
                  key={et}
                  onClick={() => toggleType(et)}
                  title={t("graph.edgeToggle", { label: EDGE_META[et] ? t(EDGE_META[et].labelKey) : et })}
                  className={`gr-chip${on ? " on" : ""}`}
                >
                  <span
                    className="sw"
                    style={{
                      background: on ? EDGE_META[et]?.color ?? "var(--text-3)" : "var(--text-3)",
                      opacity: on ? 1 : 0.4,
                    }}
                  />
                  {EDGE_META[et] ? t(EDGE_META[et].labelKey) : et}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="gr-search">
          <SearchIcon size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") focusFirstMatch();
            }}
            placeholder={t("graph.filterPlaceholder")}
            aria-label={t("graph.filterAria")}
          />
        </div>
        <button
          onClick={() => void load()}
          title={t("graph.refresh")}
          aria-label={t("graph.refreshAria")}
          className="gr-iconbtn"
        >
          <RefreshCw size={13} />
        </button>
      </Toolbar>

      <div className="flex-1 flex min-h-0">
        <div className="gr-wrap flex-1 relative">
          {loading ? (
            <div className="absolute inset-0 grid place-items-center">
              <OculSpinner label={t("graph.loading")} />
            </div>
          ) : displayNodes.length > 0 ? (
            <ReactFlow
              key={`${projectId}-${mode}-${layout}-${showAll ? "all" : "top"}`}
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeMouseEnter={onNodeHover}
              onNodeMouseLeave={onNodeHoverEnd}
              onPaneClick={() => setSelected(null)}
              onMove={onMove}
              onInit={(inst) => {
                flowRef.current = inst as unknown as FlowApi;
              }}
              fitView
              // Floor the *initial* fit zoom so a large graph opens at a
              // readable scale (labels legible) instead of tiny-fit-everything.
              // The user can still zoom out to 0.05 for the overview (LOD pills).
              // 전체 보기(showAll)는 그래프가 훨씬 크므로 플로어를 낮춘다.
              fitViewOptions={{ padding: 0.2, minZoom: showAll ? 0.18 : 0.5, maxZoom: 1.2 }}
              minZoom={0.05}
              maxZoom={2}
              onlyRenderVisibleElements
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="var(--sep-strong)" />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                // SVG rects can't resolve CSS vars — fall back to a concrete
                // gray for unknown-language nodes (whose color is a token var).
                // (mask 색은 graph.css 의 --gr-mask 가 테마별로 담당.)
                nodeColor={(n) => {
                  const c = (n.data as unknown as GraphNodeData)?.color;
                  return c && c.startsWith("#") ? c : "#94a3b8";
                }}
              />
              {legend.length > 0 ? (
                <Panel position="top-left">
                  <div className="gr-panel gr-legend">
                    <div className="gr-legend-row">
                      {legend.map(([lang, color]) => (
                        <span key={lang} className="gr-legend-item">
                          <span className="sw" style={{ background: color }} />
                          {lang}
                        </span>
                      ))}
                    </div>
                    <div className="gr-legend-row">
                      {/* 방향 화살표 도입에 맞춘 읽는 법 — A → B = A 가 B 를 사용 */}
                      <span className="gr-legend-item" style={{ opacity: 0.8 }}>
                        {t("graph.arrowHint")}
                      </span>
                      {mode === "dir" ? (
                        <span className="gr-legend-item" style={{ opacity: 0.8 }}>
                          {t("graph.drilldownHint")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Panel>
              ) : null}
              {focusActive ? (
                <Panel position="top-right">
                  <div className="gr-panel">
                    <button onClick={() => setSelected(null)} className="gr-panel-btn">
                      {t("graph.clearFocus")}
                    </button>
                  </div>
                </Panel>
              ) : null}
            </ReactFlow>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div className="max-w-sm">
                <FileCode2 size={28} />
                <p className="mt-3 text-sm font-semibold text-foreground">
                  {loadError
                    ? t("graph.loadFailed")
                    : query
                      ? t("graph.noFilterMatch")
                      : t("graph.noRelations")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {loadError
                    ? loadError
                    : query
                      ? t("graph.filterHint")
                      : t("graph.indexHint")}
                </p>
                <button
                  onClick={() => void load()}
                  className="mt-3 px-3 py-1.5 rounded-md border border-border bg-background text-xs text-foreground hover:border-primary/50 cursor-pointer"
                >
                  {t("graph.refresh")}
                </button>
              </div>
            </div>
          )}
        </div>

        {sel ? (
          <GraphInspector
            projectId={projectId}
            projectRoot={projectRoot}
            node={sel}
            unit={unit}
            fileById={fileById}
            out={neighbors.out}
            incoming={neighbors.incoming}
            symbols={symbols}
            callGroups={callGroups}
            hubThreshold={hubThreshold}
            externalEditorCommand={settings.externalEditorCommand}
            onOpenInCode={onOpenInCode}
            onPick={setSelected}
            onOpenFileNode={(fid) => {
              setMode("file");
              setSelected(`f${fid}`);
            }}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
