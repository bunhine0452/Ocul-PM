/**
 * 계획을 화면이 읽는 모양으로 접는 **순수 함수** (Osaurus 라운드 Phase 6
 * `#config-approval-card`).
 *
 * 컴포넌트에서 분리한 이유는 승인 카드가 "무엇을 보여 주는가" 가 이 라운드의
 * 규약이기 때문이다 — 이행 불가 항목이 목록에서 조용히 빠지는 회귀를 렌더링
 * 없이 단언한다.
 */

import type { ConfigOp, ConfigPlan, ConfigPlanItem, ConfigSurface } from "@/lib/bindings";
import type { I18nKey } from "@/i18n";

/** 카드에 줄로 나오는 op. `unchanged` 는 줄이 아니라 **합계**로만 나온다. */
export type VisibleOp = Exclude<ConfigOp, "unchanged">;

export interface PlanGroup {
  op: VisibleOp;
  items: ConfigPlanItem[];
}

/** 표시 순서 — 쓰는 것 먼저, 못 하는 것 마지막. */
const OP_ORDER: VisibleOp[] = ["add", "change", "blocked"];

export function groupPlan(plan: ConfigPlan): PlanGroup[] {
  return OP_ORDER.map((op) => ({
    op,
    items: plan.items.filter((i) => i.op === op),
  })).filter((g) => g.items.length > 0);
}

/** 쓸 것이 하나라도 있는가. 없으면 「적용」 버튼이 뜨지 않는다. */
export function hasWrites(plan: ConfigPlan): boolean {
  return plan.added + plan.changed > 0;
}

export function surfaceLabelKey(surface: ConfigSurface): I18nKey {
  return `settings.declarative.surface.${surface}` as I18nKey;
}

/**
 * 이행 불가 사유 → i18n 키. 모르는 코드도 **키를 만들어** 넘긴다 — `t` 는
 * 모르는 키를 키 그대로 돌려주므로 화면에 코드가 그대로 뜨고, 조용히
 * 사라지지 않는다.
 */
export function reasonKey(reason: string | null): I18nKey {
  return `settings.declarative.reason.${reason ?? "unknown"}` as I18nKey;
}
