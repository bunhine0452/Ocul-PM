// dagre hierarchical layout for the code map (PR-GR0). Left-to-right ranks so
// import depth reads as columns (계승: legacy 칸반의 "깊이" 직관). Pure function —
// takes node ids + edges, returns id → {x,y} top-left positions for React Flow.
import dagre from "@dagrejs/dagre";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
} from "d3-force";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";

export const NODE_W = 184;
export const NODE_H = 54;

// Importance tiers (readability redesign 2026-06-17). A node's visual size
// encodes its centrality (total degree = imports + imported-by) so hubs read
// as big and leaves as small at a glance — the single biggest legibility win on
// a dense graph. Layout uses these dimensions so larger nodes never overlap.
export interface NodeSize {
  w: number;
  h: number;
  tier: 0 | 1 | 2 | 3 | 4;
}
// Heights fit the NEAR card content (title + sub + optional counts) so React
// Flow's forced wrapper height never clips. tier ≥ 2 (h ≥ 58) shows the
// ←in/out→ counts row; smaller nodes show title + sub only.
export function sizeForDegree(deg: number): NodeSize {
  if (deg <= 0) return { w: 128, h: 44, tier: 0 };
  if (deg <= 2) return { w: 150, h: 48, tier: 1 };
  if (deg <= 6) return { w: 176, h: 58, tier: 2 };
  if (deg <= 14) return { w: 204, h: 66, tier: 3 };
  return { w: 238, h: 78, tier: 4 };
}

type SizeMap = Map<string, NodeSize>;
const sizeOf = (sizes: SizeMap | undefined, id: string): NodeSize =>
  sizes?.get(id) ?? { w: NODE_W, h: NODE_H, tier: 2 };

export function dagreLayout(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  sizes?: SizeMap,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // 플로팅 엣지 도입에 맞춘 간격 — rank 간 여백을 키워 화살표가 숨 쉴 자리를
  // 주고, 같은 rank 안은 살짝 조인다 (edgesep 는 엣지 라우팅 간섭 완화).
  g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 128, edgesep: 16, marginx: 24, marginy: 24 });
  nodeIds.forEach((id) => {
    const s = sizeOf(sizes, id);
    g.setNode(id, { width: s.w, height: s.h });
  });
  edges.forEach((e) => {
    if (e.source !== e.target) g.setEdge(e.source, e.target);
  });
  dagre.layout(g);
  const pos = new Map<string, { x: number; y: number }>();
  nodeIds.forEach((id) => {
    const n = g.node(id);
    const s = sizeOf(sizes, id);
    if (n) pos.set(id, { x: n.x - s.w / 2, y: n.y - s.h / 2 });
  });
  return pos;
}

// Force-directed ("유기형") layout — spreads hub-and-spoke graphs across 2D
// instead of stacking spokes in one tall rank (which dagre does). Seeded
// deterministically (circle by index, no Math.random) and run synchronously for
// a fixed number of ticks so the result is stable across renders.
interface FNode {
  id: string;
  x: number;
  y: number;
}
export function forceLayout(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  clustered = false,
  sizes?: SizeMap,
): Map<string, { x: number; y: number }> {
  const n = nodeIds.length;
  if (n === 0) return new Map();
  const ids = new Set(nodeIds);
  const links = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    .map((e) => ({ source: e.source, target: e.target }));

  // Louvain community detection → each community gets a target center; cohesion
  // forces pull members together into compact blobs (uses far less canvas than
  // the plain spread while keeping every node visible).
  let community: Map<string, number> | null = null;
  const centers = new Map<number, { x: number; y: number }>();
  if (clustered) {
    const g = new Graph({ type: "undirected" });
    nodeIds.forEach((id) => g.addNode(id));
    links.forEach((e) => {
      if (!g.hasEdge(e.source, e.target)) g.addEdge(e.source, e.target);
    });
    const assign = louvain(g) as Record<string, number>;
    community = new Map(Object.entries(assign));
    const comms = [...new Set(community.values())];
    const k = Math.max(1, comms.length);
    const cr = Math.max(300, k * 150);
    comms.forEach((c, i) => {
      const a = (i / k) * Math.PI * 2;
      centers.set(c, { x: Math.cos(a) * cr, y: Math.sin(a) * cr });
    });
  }

  const r = Math.max(220, n * 22);
  const nodes: FNode[] = nodeIds.map((id, i) => {
    const a = (i / n) * Math.PI * 2;
    if (clustered && community) {
      const c = centers.get(community.get(id) ?? 0) ?? { x: 0, y: 0 };
      return { id, x: c.x + Math.cos(a) * 30, y: c.y + Math.sin(a) * 30 };
    }
    return { id, x: Math.cos(a) * r, y: Math.sin(a) * r };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sim = forceSimulation(nodes as any)
    .force("charge", forceManyBody().strength(clustered ? -160 : -440))
    .force(
      "link",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forceLink(links as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .id((d: any) => d.id)
        .distance(clustered ? 64 : 160)
        .strength(clustered ? 0.18 : 0.45),
    )
    // Collide radius scales with each node's importance size so big hubs keep
    // clear of their neighbours.
    .force(
      "collide",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forceCollide((d: any) => {
        const s = sizeOf(sizes, d.id);
        return Math.max(s.w, s.h) * (clustered ? 0.55 : 0.62);
      }),
    )
    .stop();
  if (clustered && community) {
    const cx = (id: string) => (centers.get(community!.get(id) ?? 0) ?? { x: 0, y: 0 }).x;
    const cy = (id: string) => (centers.get(community!.get(id) ?? 0) ?? { x: 0, y: 0 }).y;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.force("x", forceX((d: any) => cx(d.id)).strength(0.38));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sim.force("y", forceY((d: any) => cy(d.id)).strength(0.38));
  } else {
    sim.force("center", forceCenter(0, 0));
  }
  const ticks = Math.min(400, Math.max(140, n * 6));
  for (let i = 0; i < ticks; i++) sim.tick();
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((nd) => {
    const s = sizeOf(sizes, nd.id);
    pos.set(nd.id, { x: nd.x - s.w / 2, y: nd.y - s.h / 2 });
  });
  return pos;
}
