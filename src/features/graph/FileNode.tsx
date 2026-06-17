// Custom React Flow node for the code map. Renders a file OR a folder (grouped
// mode) at one of three levels of detail (LOD) driven by the canvas zoom, and
// at a size that encodes the node's importance (degree). Readability redesign
// (2026-06-17):
//   • size  — bigger node = more central (more imports + imported-by).
//   • LOD    — "far" (zoomed out): a label pill (text stays legible instead of a
//              wall of identical cards). "mid": stripe + name + sub. "near":
//              full card with the ←in/out→ counts (tier ≥ 2).
//   • dims   — the node gets an EXPLICIT width/height (set in GraphScreenV2) so
//              React Flow knows every node's size even when it's off-screen
//              (onlyRenderVisibleElements). That's also what makes the MiniMap
//              able to draw bounds — so this fills the forced wrapper box
//              exactly (height: 100%, overflow hidden) to avoid clipping.
// Selection + dim states come from GraphScreenV2 through `data`.
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type Lod = "far" | "mid" | "near";

export interface GraphNodeData {
  kind: "file" | "dir";
  label: string;
  sub: string;
  language: string | null;
  color: string; // language color (or dominant language for a folder)
  fileCount: number; // dir mode: files in the folder; file mode: 1
  inCount: number;
  outCount: number;
  selected: boolean;
  dimmed: boolean;
  // Readability redesign
  w: number; // importance-scaled width (from layout.sizeForDegree)
  h: number;
  tier: 0 | 1 | 2 | 3 | 4; // 0 = isolated … 4 = top hub
  lod: Lod;
  hub: boolean; // top-tier — gets a stronger accent
}

const labelSize = (tier: number, lod: Lod): string => {
  if (lod === "far") return tier >= 3 ? "text-[13px]" : "text-[11px]";
  if (tier >= 4) return "text-[14px]";
  if (tier >= 3) return "text-[13px]";
  return "text-[12px]";
};

function FileNodeImpl(props: NodeProps) {
  const d = props.data as unknown as GraphNodeData;
  const ring = d.selected
    ? "border-primary ring-2 ring-primary/30"
    : d.hub
      ? "border-primary/45"
      : "border-border";
  const dim = d.dimmed ? "opacity-20" : "";
  // Fill the box React Flow forces from the node's explicit width/height.
  const box = { width: "100%", height: "100%" } as const;

  // FAR — a compact label pill. No sub-line, no counts; just a colored dot and
  // the name so a 500-node graph reads as a labelled map, not a card storm.
  if (d.lod === "far") {
    return (
      <div
        style={box}
        className={`flex items-center gap-1.5 overflow-hidden rounded-md border bg-card px-2 shadow-sm transition-opacity ${ring} ${dim}`}
      >
        <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        <span className="w-2 h-2 rounded-sm flex-none" style={{ background: d.color }} />
        <span className={`truncate font-semibold text-foreground ${labelSize(d.tier, "far")}`} title={d.label}>
          {d.kind === "dir" ? `${d.label}/` : d.label}
        </span>
        {d.kind === "dir" ? (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums flex-none">{d.fileCount}</span>
        ) : null}
        <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      </div>
    );
  }

  const near = d.lod === "near";
  const showCounts = near && d.tier >= 2;
  return (
    <div
      style={box}
      className={`relative flex flex-col justify-center overflow-hidden rounded-lg border bg-card pl-3 pr-2.5 shadow-sm transition-opacity ${ring} ${dim}`}
    >
      <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg" style={{ background: d.color }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="flex items-center gap-1.5">
        <div className={`font-semibold text-foreground truncate flex-1 ${labelSize(d.tier, d.lod)}`} title={d.label}>
          {d.kind === "dir" ? `${d.label}/` : d.label}
        </div>
        {d.kind === "dir" ? (
          <span className="text-[10px] text-muted-foreground tabular-nums flex-none">{d.fileCount}</span>
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {d.sub ? (
          <span className="truncate flex-1" title={d.sub}>
            {d.sub}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {d.kind === "file" && d.language ? (
          <span className="px-1 rounded bg-muted text-[9px] uppercase tracking-wide flex-none">{d.language}</span>
        ) : null}
      </div>
      {showCounts ? (
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
          <span title="이 노드를 import 하는 수">← {d.inCount}</span>
          <span title="이 노드가 import 하는 수">{d.outCount} →</span>
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

export const FileNode = memo(FileNodeImpl);
