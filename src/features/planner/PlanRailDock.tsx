/**
 * 계획 레일의 **자리** — 폭(드래그) · 붙는 쪽(좌/우) 을 맡는다.
 *
 * 레일 자체(`PlanRail`)는 목록을 그리는 일만 하고, 이 껍데기가 크기와 위치를
 * 소유한다. 화면(`PlannerScreenV2`)은 좌/우 두 자리 중 하나에 이 컴포넌트를
 * **DOM 순서 그대로** 렌더한다 — `row-reverse` 로 뒤집으면 Tab 이동이 눈에
 * 보이는 차례와 어긋난다 (코드 화면 사이드바·터미널 도크와 같은 원칙).
 *
 * 드래그 중에는 로컬 값으로만 그리고 놓는 순간 영속한다. 매 이동마다
 * WorkspaceContext 를 통과시키면 창 전체가 60fps 로 리렌더된다.
 */

import { useCallback, useRef, useState, type ComponentProps } from "react";
import { PlanRail } from "./PlanRail";
import { useT } from "@/i18n";

/** 폭의 하한·상한·기본값. 상한은 CSS 의 컨테이너 폭 클램프가 한 번 더 막는다. */
export const RAIL_MIN_W = 170;
export const RAIL_MAX_W = 460;
export const RAIL_DEFAULT_W = 236;

export const clampRailWidth = (w: number) =>
  Math.min(RAIL_MAX_W, Math.max(RAIL_MIN_W, Math.round(w)));

interface PlanRailDockProps extends ComponentProps<typeof PlanRail> {
  width: number;
  onWidthChange: (width: number) => void;
}

export function PlanRailDock({ width, onWidthChange, ...railProps }: PlanRailDockProps) {
  const { t } = useT();
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const w = live ?? width;
  const onRight = railProps.side === "right";

  // 오른쪽에 붙으면 끄는 방향이 뒤집힌다 — 왼쪽으로 끌수록 넓어진다.
  const widthAt = (clientX: number) => {
    const d = drag.current;
    if (!d) return w;
    const delta = onRight ? d.startX - clientX : clientX - d.startX;
    return clampRailWidth(d.startW + delta);
  };

  const commit = useCallback(
    (next: number) => {
      setLive(null);
      onWidthChange(next);
    },
    [onWidthChange],
  );

  const resizer = (
    <div
      className="pln-rail-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("plan.railResize")}
      aria-valuenow={w}
      aria-valuemin={RAIL_MIN_W}
      aria-valuemax={RAIL_MAX_W}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startW: w };
      }}
      onPointerMove={(e) => {
        if (drag.current) setLive(widthAt(e.clientX));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        const next = widthAt(e.clientX);
        drag.current = null;
        commit(next);
      }}
      // 더블클릭으로 기본 폭 — 끌다가 망친 폭을 되돌릴 길이 있어야 한다.
      onDoubleClick={() => commit(RAIL_DEFAULT_W)}
      onKeyDown={(e) => {
        // 키보드로도 조절된다 — 드래그만 있으면 separator 는 장식이다.
        const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
        if (step === 0) return;
        e.preventDefault();
        commit(clampRailWidth(w + (onRight ? -step : step)));
      }}
    />
  );

  const rail = (
    <div className="pln-rail-slot" style={{ width: w }}>
      <PlanRail {...railProps} />
    </div>
  );

  return onRight ? (
    <>
      {resizer}
      {rail}
    </>
  ) : (
    <>
      {rail}
      {resizer}
    </>
  );
}
