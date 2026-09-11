// 플랜 트리의 순수 부분 — `vscode` 를 임포트하지 않아 vitest 가 판정한다.
import type { ItemStatus, PlanItem } from "../oculpm/planner";

/** 글리프 → codicon + 색. Rust 6종 상태값과 1:1. */
export const STATUS_ICON: Record<ItemStatus, { icon: string; color?: string; label: string }> = {
  todo: { icon: "circle-large-outline", label: "할일" },
  in_progress: { icon: "play-circle", color: "charts.yellow", label: "진행중" },
  done: { icon: "pass-filled", color: "testing.iconPassed", label: "완료" },
  blocked: { icon: "error", color: "errorForeground", label: "막힘" },
  deferred: { icon: "arrow-right", color: "descriptionForeground", label: "이월" },
  dropped: { icon: "circle-slash", color: "disabledForeground", label: "폐기" },
};

export function progressOf(items: PlanItem[]): { done: number; total: number } {
  // 부모는 롤업 파생값이라 리프만 센다 — 앱 플래너와 같은 셈법.
  const parents = new Set(items.map((i) => i.parentItem).filter((p): p is string => p !== undefined));
  const leaves = items.filter((i) => !parents.has(i.itemId) && i.status !== "dropped");
  return { done: leaves.filter((i) => i.status === "done").length, total: leaves.length };
}

export type CheckboxRule =
  | { kind: "checkbox"; checked: boolean }
  | { kind: "none"; reason: string };

/**
 * 체크박스를 그릴지 — 리프만(부모는 롤업 파생값이라 서버가 거부), 활성 플랜만
 * (잠긴 플랜은 `plan_update` 가 거부), 바이너리가 있을 때만(쓰기는 oculpm-mcp 경유).
 */
export function checkboxFor(
  item: PlanItem,
  plan: { status: string; items: PlanItem[] },
  readOnly: boolean,
): CheckboxRule {
  if (plan.status !== "active") {
    return { kind: "none", reason: "잠긴 플랜 — done/archived 플랜은 수정할 수 없습니다" };
  }
  if (plan.items.some((i) => i.parentItem === item.itemId)) {
    return { kind: "none", reason: "하위 롤업 — 하위 항목을 갱신하면 자동 계산됩니다" };
  }
  if (readOnly) {
    return { kind: "none", reason: "읽기 전용 — Ocul-PM 앱의 oculpm-mcp 가 없습니다" };
  }
  return { kind: "checkbox", checked: item.status === "done" };
}
