// Custom React Flow node for the code map. Renders a file OR a folder (grouped
// mode) at one of three levels of detail (LOD) driven by the canvas zoom, and
// at a size that encodes the node's importance (degree).
//
// 2026-08-16 리디자인: 좌측 스트라이프 → 언어 틴트 카드로. 카드 배경·테두리가
// 언어 색(--gn-tint)을 머금고, 글리프(폴더=사각/파일=원)가 색을 명시한다.
// 크기(tier)는 인라인 px 대신 .t0~.t4 클래스로 CSS 가 담당. 허브는 near LOD
// 에서 라벨 태그(t("graph.role.hub"))로 승격 — 색 링만으로는 안 읽혔다.
//
// dims — the node gets an EXPLICIT width/height (set in GraphScreenV2) so React
// Flow knows every node's size even when it's off-screen
// (onlyRenderVisibleElements); the card fills that box (100%/100%).
import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { t, useT } from "@/i18n";

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

const stateClass = (d: GraphNodeData): string =>
  (d.selected ? " sel" : "") +
  (d.hub && !d.selected ? " hub" : "") +
  (d.dim === "hard" ? " dim-hard" : d.dim === "soft" ? " dim-soft" : "");

function FileNodeImpl(props: NodeProps) {
  useT();
  const d = props.data as unknown as GraphNodeData;
  const tint = { "--gn-tint": d.color } as CSSProperties;

  // FAR — a compact label pill: colored glyph + name only, so a 500-node graph
  // reads as a labelled map, not a card storm.
  if (d.lod === "far") {
    return (
      <div className={`gn far t${d.tier}${stateClass(d)}`} style={tint}>
        <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        <span className={`gn-glyph ${d.kind}`} aria-hidden="true" />
        <span className="gn-name" title={d.label}>
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
    <div className={`gn t${d.tier}${stateClass(d)}`} style={tint}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="gn-row">
        <span className={`gn-glyph ${d.kind}`} aria-hidden="true" />
        <span className="gn-name" title={d.label}>
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
          <span title={t("graph.inCount")}>↓ {d.inCount}</span>
          <span title={t("graph.outCount")}>↑ {d.outCount}</span>
          {d.hub ? <span className="gn-hubtag">{t("graph.role.hub")}</span> : null}
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
