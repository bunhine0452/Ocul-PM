/**
 * 빈 상태 하나 — 두 밀도 (v3-surface {#empty-state-component}).
 *
 * 그전까지 이 앱의 "비어 있음"은 세 갈래로 흩어져 있었다: `.empty-hint` 한 줄
 * 52곳, 화면마다 손으로 짠 리치 빈 상태 3벌(docs·code·projects), 그리고 그
 * 3벌이 각자 데려온 전용 클래스 8종. 같은 뜻을 세 가지 무게로 말하면 사용자는
 * "이건 오류인가 아직 안 끝난 건가"를 화면마다 다시 배운다.
 *
 * 두 밀도만 둔다:
 *
 *  - `plain` — 목록 안·패널 안의 한 줄. 예전 `.empty-hint` 자리.
 *  - `rich`  — 화면 전체가 비었을 때. 아이콘·제목·설명·행동.
 *
 * **일러스트는 없다.** 이 앱은 밀도 도구다 — 빈 화면에 그림을 넣으면 그
 * 자리를 차지하는 것은 "무엇을 하면 채워지는가"가 아니라 장식이 된다.
 *
 * `actions` 는 노드로 받는다. 버튼의 모양·순서·비활성 조건은 부르는 화면이
 * 아는 사실이고, 여기서 표로 받으면 화면마다 표 밖의 예외가 생긴다.
 */
import type { CSSProperties, ReactNode } from "react";

import type { IconComponent } from "@/components/Icons";

export interface EmptyStateProps {
  /** 기본은 `plain` — 옮겨온 자리 대부분이 한 줄짜리다. */
  density?: "plain" | "rich";
  /** `rich` 에서만 그린다. 그 자리가 무엇인지 말하는 아이콘 (장식 금지). */
  icon?: IconComponent;
  title?: ReactNode;
  /** 설명 — "비어 있다"가 아니라 "무엇을 하면 채워지는가". */
  children?: ReactNode;
  /** 버튼들. 하나라도 있으면 이 빈 상태는 막다른 길이 아니게 된다. */
  actions?: ReactNode;
  /** 가운데가 어색한 자리(목록 옆·코드 옆)는 왼쪽으로. */
  align?: "center" | "start";
  className?: string;
  style?: CSSProperties;
  /** 상태 변화로 나타나는 빈 상태에는 `status` 를 준다. */
  role?: string;
}

export function EmptyState({
  density = "plain",
  icon: Icon,
  title,
  children,
  actions,
  align = "center",
  className,
  style,
  role,
}: EmptyStateProps) {
  const cls = [
    "es",
    density === "rich" ? "es--rich" : "es--plain",
    align === "start" ? "es--start" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} style={style} role={role}>
      {Icon ? <Icon size={30} strokeWidth={1.5} className="es-ico" aria-hidden="true" /> : null}
      {title ? <div className="es-title">{title}</div> : null}
      {children ? <div className="es-desc">{children}</div> : null}
      {actions ? <div className="es-actions">{actions}</div> : null}
    </div>
  );
}

export default EmptyState;
