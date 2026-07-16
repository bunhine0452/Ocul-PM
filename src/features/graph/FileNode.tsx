// Custom React Flow node for the code map. Renders a file OR a folder (grouped
// mode) at one of three levels of detail (LOD) driven by the canvas zoom, and
// at a size that encodes the node's importance (degree).
//
// 2026-07-16 재작업: Tailwind 유틸 혼용을 걷어내고 Atelier 토큰 클래스(.gn — graph.css)
// 로 통일. dim 이 2단계가 됐다(soft=호버 하이라이트의 주변 감쇠 / hard=선택 포커스
// 밖). 폴더 노드는 near LOD 에서 언어 구성 미니 바(langMix)를 깐다.
//
// dims — the node gets an EXPLICIT width/height (set in GraphScreenV2) so React
// Flow knows every node's size even when it's off-screen
// (onlyRenderVisibleElements); the card fills that box (100%/100%).
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type Lod = "far" | "mid" | "near";
export type NodeDim = "none" | "soft" | "hard";

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
  dim: NodeDim;
  w: number; // importance-scaled width (from layout.sizeForDegree)
  h: number;
  tier: 0 | 1 | 2 | 3 | 4; // 0 = isolated … 4 = top hub
  lod: Lod;
  hub: boolean; // top-tier — gets a stronger accent
  /** 폴더 노드의 언어 구성 (상위 3 + 기타). near LOD 미니 바. */
  langMix?: { color: string; ratio: number }[];
}

const nameSizePx = (tier: number, lod: Lod): number => {
  if (lod === "far") return tier >= 3 ? 13 : 11;
  if (tier >= 4) return 14;
  if (tier >= 3) return 13;
  return 12;
};

const stateClass = (d: GraphNodeData): string =>
  (d.selected ? " sel" : "") +
  (d.hub && !d.selected ? " hub" : "") +
  (d.dim === "hard" ? " dim-hard" : d.dim === "soft" ? " dim-soft" : "");

function FileNodeImpl(props: NodeProps) {
  const d = props.data as unknown as GraphNodeData;

  // FAR — a compact label pill: colored dot + name only, so a 500-node graph
  // reads as a labelled map, not a card storm.
  if (d.lod === "far") {
    return (
      <div className={`gn far${stateClass(d)}`}>
        <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        <span className="gn-dot" style={{ background: d.color }} />
        <span
          className="gn-name"
          style={{ fontSize: nameSizePx(d.tier, "far") }}
          title={d.label}
        >
          {d.kind === "dir" ? `${d.label}/` : d.label}
        </span>
        {d.kind === "dir" ? <span className="gn-badge">{d.fileCount}</span> : null}
        <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      </div>
    );
  }

  const near = d.lod === "near";
  const showCounts = near && d.tier >= 2;
  const showMix = near && d.kind === "dir" && (d.langMix?.length ?? 0) > 1;
  return (
    <div className={`gn${stateClass(d)}`}>
      <span className="gn-stripe" style={{ background: d.color }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="gn-row">
        <span
          className="gn-name"
          style={{ fontSize: nameSizePx(d.tier, d.lod) }}
          title={d.label}
        >
          {d.kind === "dir" ? `${d.label}/` : d.label}
        </span>
        {d.kind === "dir" ? (
          <span className="gn-badge">{d.fileCount}</span>
        ) : d.language && near ? (
          <span className="gn-chip">{d.language}</span>
        ) : null}
      </div>
      {d.sub ? (
        <div className="gn-sub" title={d.sub}>
          {d.sub}
        </div>
      ) : null}
      {showCounts ? (
        <div className="gn-cnt">
          <span title="이 노드를 참조하는 수">← {d.inCount}</span>
          <span title="이 노드가 참조하는 수">{d.outCount} →</span>
        </div>
      ) : null}
      {showMix ? (
        <span className="gn-mix" aria-hidden="true">
          {d.langMix!.map((m, i) => (
            <i key={i} style={{ background: m.color, width: `${Math.max(4, m.ratio * 100)}%` }} />
          ))}
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

export const FileNode = memo(FileNodeImpl);
