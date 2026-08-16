// 코드 맵 커스텀 엣지 — 플로팅 + 방향 화살표 (그래프 리디자인 2026-08-16).
// 고정 좌/우 핸들 대신 두 노드 사각형의 실제 경계 교차점을 잇는다. 기하는
// floatingEdgeMath(순수)가 담당하고, 여기는 React Flow 어댑터만.
import { memo } from "react";
import {
  BaseEdge,
  getBezierPath,
  useInternalNode,
  Position,
  type EdgeProps,
} from "@xyflow/react";
import { floatingEdgeGeom, type NodeRect, type Side } from "./floatingEdgeMath";

type InternalNode = NonNullable<ReturnType<typeof useInternalNode>>;

const SIDE_TO_POSITION: Record<Side, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

function rectOf(n: InternalNode): NodeRect {
  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured?.width ?? n.width ?? 0,
    h: n.measured?.height ?? n.height ?? 0,
  };
}

function FloatingEdgeImpl({ id, source, target, markerEnd, style }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const sr = rectOf(sourceNode);
  const tr = rectOf(targetNode);
  if (sr.w === 0 || sr.h === 0 || tr.w === 0 || tr.h === 0) return null;
  const g = floatingEdgeGeom(sr, tr);
  const [path] = getBezierPath({
    sourceX: g.sx,
    sourceY: g.sy,
    sourcePosition: SIDE_TO_POSITION[g.sourceSide],
    targetX: g.tx,
    targetY: g.ty,
    targetPosition: SIDE_TO_POSITION[g.targetSide],
    curvature: 0.18,
  });
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

export const FloatingEdge = memo(FloatingEdgeImpl);
