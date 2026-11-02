/**
 * 칸 트리를 그린다 (11-02, Orca 「split panes」) — 나눔은 flex 한 줄(row/column)과 그 사이 경계,
 * 잎은 터미널 세션 하나. 경계는 끌어서 비율을, 두 번 누르면 모든 칸을 고르게(Orca 「Equalize」).
 * 키보드로는 경계에 초점을 두고 화살표. 모양은 `paneLayout.ts` 가 값으로 들고 여기는 그리기만.
 */
import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { mountTerm } from "./termStore";
import type { PaneNode } from "./paneLayout";

/** 경계를 끌어도 칸이 이보다 좁아(낮아)지지 않는다 — 셸 프롬프트 한 줄은 보이게. */
export const SPLIT_MIN = { row: 160, col: 72 } as const;
const KEY_STEP = 0.05;

export interface PaneTreeProps {
  node: PaneNode;
  active: number | null;
  dropOver: number | null;
  dropHint: string;
  /** 칸이 둘 이상일 때 칸 머리 — 하나면 `null`. */
  head: (id: number) => ReactNode;
  onActivate: (id: number) => void;
  onRatio: (path: string, ratio: number) => void;
  onEqualize: () => void;
  separatorLabel: string;
  /** 고른 칸 위에만 얹는 것 — 찾기 줄. */
  overlay?: ReactNode;
}

export function PaneTree(props: PaneTreeProps) {
  return <Node {...props} path="" />;
}

function Node(props: PaneTreeProps & { path: string }) {
  const { node, path } = props;
  if (node.kind === "leaf") return <Leaf {...props} id={node.id} />;
  return (
    <div className={"tm-node is-" + node.dir}>
      <div className="tm-node-part" style={{ flex: `${node.ratio} 1 0%` }}>
        <Node {...props} node={node.a} path={path + "a"} />
      </div>
      <Divider {...props} dir={node.dir} ratio={node.ratio} />
      <div className="tm-node-part" style={{ flex: `${1 - node.ratio} 1 0%` }}>
        <Node {...props} node={node.b} path={path + "b"} />
      </div>
    </div>
  );
}

function Leaf({ id, active, dropOver, dropHint, head, onActivate, overlay }: PaneTreeProps & { id: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isActive = id === active;
  // 나눌 때마다 트리 모양이 바뀌어 칸이 다시 서도, 초점은 고른 칸에만 — 마지막에 선 칸이 빼앗지 않게.
  useEffect(() => {
    if (!ref.current) return;
    return mountTerm(id, ref.current, isActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const top = head(id);
  return (
    <div
      className={"tm-leaf" + (isActive && top ? " is-active" : "")}
      onFocusCapture={() => onActivate(id)}
      onMouseDown={() => onActivate(id)}
    >
      {top}
      <div
        className={"tm-pane" + (dropOver === id ? " is-drop" : "")}
        ref={ref}
        data-term-id={id}
        data-drop-hint={dropHint}
      />
      {isActive ? overlay : null}
    </div>
  );
}

function Divider({
  dir,
  ratio,
  path,
  onRatio,
  onEqualize,
  separatorLabel,
}: PaneTreeProps & { path: string; dir: "row" | "col"; ratio: number }) {
  const ratioAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!box) return null;
    const size = dir === "row" ? box.width : box.height;
    if (size <= 0) return null;
    const pos = dir === "row" ? e.clientX - box.left : e.clientY - box.top;
    const min = Math.min(0.5, SPLIT_MIN[dir] / size);
    return Math.min(1 - min, Math.max(min, pos / size));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    const r = ratioAt(e);
    if (r != null) onRatio(path, r);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const back = dir === "row" ? "ArrowLeft" : "ArrowUp";
    const fwd = dir === "row" ? "ArrowRight" : "ArrowDown";
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    onRatio(path, ratio + (e.key === fwd ? KEY_STEP : -KEY_STEP));
  };
  return (
    <div
      className="tm-divider"
      role="separator"
      tabIndex={0}
      aria-label={separatorLabel}
      aria-orientation={dir === "row" ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onDoubleClick={onEqualize}
      onKeyDown={onKeyDown}
    />
  );
}
