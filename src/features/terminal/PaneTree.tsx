/**
 * 칸 트리를 그린다 (11-02, Orca 「split panes」) — 나눔은 flex 한 줄(row/column)과 그 사이 경계,
 * 잎은 터미널 세션 하나. 경계는 끌어서 비율을, 두 번 누르면 모든 칸을 고르게(Orca 「Equalize」).
 * 키보드로는 경계에 초점을 두고 화살표 · Home · End · Enter. 모양은 `paneLayout.ts` 가 값으로 들고 여기는 그리기만.
 *
 * 칸 위에 얹는 것(상태 띠 · 찾기 막대)은 `.tm-pane` 안에 겹쳐 띄운다 — 줄로 끼우면 띠가 서고 질 때마다
 * 터미널 높이가 바뀌어 안의 Claude 가 화면을 두 번 다시 그렸다.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { mountTerm } from "./termStore";
import type { PaneNode } from "./paneLayout";

/** 경계를 끌어도 칸이 이보다 좁아(낮아)지지 않는다 — 셸 프롬프트 한 줄은 보이게. */
export const SPLIT_MIN = { row: 160, col: 72 } as const;
const KEY_STEP = 0.05;

/**
 * 비율을 칸의 px 하한으로 막는다 — 끌기와 키보드가 같은 셈을 쓴다. 예전엔 화살표만 이 하한을 몰라 600px 줄에서
 * 칸이 60px 까지 줄었다. 크기를 모르면(0) 비율 하한만 남는다(`paneLayout.setRatio`).
 */
export function clampRatio(ratio: number, size: number, dir: "row" | "col"): number {
  if (size <= 0) return ratio;
  const min = Math.min(0.5, SPLIT_MIN[dir] / size);
  return Math.min(1 - min, Math.max(min, ratio));
}

export interface PaneTreeProps {
  node: PaneNode;
  active: number | null;
  dropOver: number | null;
  dropHint: string;
  /** 칸이 둘 이상일 때 칸 머리 — 하나면 `null`. */
  head: (id: number) => ReactNode;
  /** 칸 위에 겹치는 상태 띠 — 예외가 없으면 `null`. */
  band: (id: number) => ReactNode;
  /** 칸의 모양 — 기다림 · 끝남 (`is-wait` · `is-ended`). */
  leafClass: (id: number) => string;
  onActivate: (id: number) => void;
  onRatio: (path: string, ratio: number) => void;
  onEqualize: () => void;
  separatorLabel: string;
  /** 경계 쓰는 법 — 툴팁과 `aria-describedby`. */
  separatorHelp: string;
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

function Leaf({ id, active, dropOver, dropHint, head, band, leafClass, onActivate, overlay }: PaneTreeProps & { id: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isActive = id === active;
  // 나눌 때마다 트리 모양이 바뀌어 칸이 다시 서도, 초점은 고른 칸에만 — 마지막에 선 칸이 빼앗지 않게.
  useEffect(() => {
    if (!ref.current) return;
    return mountTerm(id, ref.current, isActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const top = head(id);
  const strip = band(id);
  const find = isActive ? overlay : null;
  const extra = leafClass(id);
  return (
    <div
      className={"tm-leaf" + (isActive && top ? " is-active" : "") + (extra ? " " + extra : "")}
      onFocusCapture={() => onActivate(id)}
      onMouseDown={() => onActivate(id)}
    >
      {top}
      <div
        className={"tm-pane" + (dropOver === id ? " is-drop" : "")}
        ref={ref}
        data-term-id={id}
        data-drop-hint={dropHint}
      >
        {strip || find ? (
          <div className="tm-over">
            {strip}
            {find}
          </div>
        ) : null}
      </div>
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
  separatorHelp,
}: PaneTreeProps & { path: string; dir: "row" | "col"; ratio: number }) {
  const helpId = useId();
  const sizeOf = (el: HTMLElement) => {
    const box = el.parentElement?.getBoundingClientRect();
    return box ? (dir === "row" ? box.width : box.height) : 0;
  };
  const ratioAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!box) return null;
    const size = dir === "row" ? box.width : box.height;
    if (size <= 0) return null;
    const pos = dir === "row" ? e.clientX - box.left : e.clientY - box.top;
    return clampRatio(pos / size, size, dir);
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
    const size = sizeOf(e.currentTarget);
    let next: number | null = null;
    if (e.key === back || e.key === fwd) next = ratio + (e.key === fwd ? KEY_STEP : -KEY_STEP);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 1;
    else if (e.key === "Enter") {
      e.preventDefault();
      onEqualize();
      return;
    }
    if (next == null) return;
    e.preventDefault();
    onRatio(path, clampRatio(next, size, dir));
  };
  return (
    <div
      className="tm-divider"
      role="separator"
      tabIndex={0}
      aria-label={separatorLabel}
      aria-describedby={helpId}
      title={separatorHelp}
      aria-orientation={dir === "row" ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onDoubleClick={onEqualize}
      onKeyDown={onKeyDown}
    >
      <span id={helpId} className="sr-only">
        {separatorHelp}
      </span>
    </div>
  );
}
