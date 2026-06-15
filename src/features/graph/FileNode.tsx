// Custom React Flow node for the code map (PR-GR0). Renders a file OR a folder
// (grouped mode) — a compact card with a language-colored left stripe, label,
// sub-line, and ←in / out→ counts. Selection + dim states come from
// GraphScreenV2 through `data`. Folder nodes also show a file count.
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

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
}

function FileNodeImpl(props: NodeProps) {
  const d = props.data as unknown as GraphNodeData;
  return (
    <div
      className={`relative w-[184px] rounded-lg border bg-card pl-3 pr-2.5 py-1.5 shadow-sm transition-opacity ${
        d.selected ? "border-primary ring-2 ring-primary/30" : "border-border"
      } ${d.dimmed ? "opacity-25" : ""}`}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg"
        style={{ background: d.color }}
      />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="flex items-center gap-1.5">
        <div className="text-[12px] font-semibold text-foreground truncate flex-1" title={d.label}>
          {d.label}
        </div>
        {d.kind === "dir" ? (
          <span className="text-[10px] text-muted-foreground tabular-nums flex-none">{d.fileCount}</span>
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {d.sub ? (
          <span className="truncate flex-1" title={d.sub}>{d.sub}</span>
        ) : (
          <span className="flex-1" />
        )}
        {d.kind === "file" && d.language ? (
          <span className="px-1 rounded bg-muted text-[9px] uppercase tracking-wide flex-none">
            {d.language}
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        <span title="이 노드를 import 하는 수">← {d.inCount}</span>
        <span title="이 노드가 import 하는 수">{d.outCount} →</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

export const FileNode = memo(FileNodeImpl);
