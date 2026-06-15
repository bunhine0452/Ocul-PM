// dagre hierarchical layout for the code map (PR-GR0). Left-to-right ranks so
// import depth reads as columns (계승: legacy 칸반의 "깊이" 직관). Pure function —
// takes node ids + edges, returns id → {x,y} top-left positions for React Flow.
import dagre from "@dagrejs/dagre";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from "d3-force";

export const NODE_W = 184;
export const NODE_H = 54;

export function dagreLayout(
  nodeIds: string[],
  edges: { source: string; target: string }[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 92, marginx: 24, marginy: 24 });
  nodeIds.forEach((id) => g.setNode(id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => {
    if (e.source !== e.target) g.setEdge(e.source, e.target);
  });
  dagre.layout(g);
  const pos = new Map<string, { x: number; y: number }>();
  nodeIds.forEach((id) => {
    const n = g.node(id);
    if (n) pos.set(id, { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 });
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
): Map<string, { x: number; y: number }> {
  const n = nodeIds.length;
  if (n === 0) return new Map();
  const r = Math.max(220, n * 22);
  const nodes: FNode[] = nodeIds.map((id, i) => {
    const a = (i / n) * Math.PI * 2;
    return { id, x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  const ids = new Set(nodeIds);
  const links = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sim = forceSimulation(nodes as any)
    .force("charge", forceManyBody().strength(-440))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .force("link", forceLink(links as any).id((d: any) => d.id).distance(160).strength(0.45))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(Math.max(NODE_W, NODE_H) * 0.62))
    .stop();
  const ticks = Math.min(400, Math.max(140, n * 6));
  for (let i = 0; i < ticks; i++) sim.tick();
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((nd) => pos.set(nd.id, { x: nd.x - NODE_W / 2, y: nd.y - NODE_H / 2 }));
  return pos;
}
