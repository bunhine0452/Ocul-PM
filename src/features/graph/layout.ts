// dagre hierarchical layout for the code map (PR-GR0). Left-to-right ranks so
// import depth reads as columns (계승: legacy 칸반의 "깊이" 직관). Pure function —
// takes node ids + edges, returns id → {x,y} top-left positions for React Flow.
import dagre from "@dagrejs/dagre";

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
