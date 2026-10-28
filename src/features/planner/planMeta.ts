/**
 * 계획 화면이 공유하는 표시 규약 — 상태 이름 · 리프 집계 · 다음 리프 · 사람 몫. React 없음.
 *
 * 「다음」과 「사람 몫」의 규칙은 백엔드 `planner/digest.rs` 와 **같다** — 오늘 화면의
 * 「다음」 카드(디지스트)와 계획 화면의 「다음」 줄(여기)이 다른 항목을 가리키면 안 된다.
 */

import type { I18nKey } from "@/i18n";
import type { PlanItemDto } from "@/lib/bindings";

export const STATUS_META: Record<string, { glyph: string; labelKey: I18nKey; color: string }> = {
  todo: { glyph: "☐", labelKey: "plan.status.todo", color: "var(--text-3)" },
  in_progress: { glyph: "▣", labelKey: "plan.status.in_progress", color: "var(--accent)" },
  done: { glyph: "☑", labelKey: "plan.status.done", color: "var(--accent)" },
  // U+FE0E (text presentation selector): ⚠ 는 기본이 컬러 이모지라 OS 이모지 폰트로 그려진다.
  blocked: { glyph: "⚠︎", labelKey: "plan.status.blocked", color: "var(--t-bug)" },
  deferred: { glyph: "→", labelKey: "plan.status.deferred", color: "var(--text-3)" },
  dropped: { glyph: "✗", labelKey: "plan.status.dropped", color: "var(--text-3)" },
};

/** 옛 계획 화면의 보기(문서/보드) — `workspaceState` 가 아직 영속한다. 4.0 은 문서 하나다. */
export type PlanView = "doc" | "board";

/** 단계 없는 항목의 **그룹 키**. 표시 라벨은 `t("plan.noPhase")` 로 따로 그린다. */
export const NO_PHASE = "__no_phase__";

/**
 * 하위를 가진 부모는 파생값이라 모든 집계에서 뺀다 (백엔드 `parent_ids()` 와 같은 규칙).
 * 부모까지 세면 「32/35 완료」 옆에 「완료 34」 가 붙는다.
 */
export function leafItems(items: readonly PlanItemDto[]): PlanItemDto[] {
  const parents = new Set(items.map((i) => i.parent_item).filter((p): p is string => !!p));
  return items.filter((i) => !parents.has(i.item_id));
}

export function countByStatus(items: readonly PlanItemDto[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const it of items) c[it.status] = (c[it.status] ?? 0) + 1;
  return c;
}

/** 항목 문구가 사람 몫인가 — `[사용자]`·`[사용자 결정]`·`[사용자 액션]`·`[user]` (digest.rs `is_user_item`). */
export function isUserItem(title: string): boolean {
  const s = title.trimStart();
  return s.startsWith("[사용자") || s.slice(0, 5).toLowerCase() === "[user"; // i18n-ignore -- 계획 파일 문법의 머리표, 표시 문구가 아니다
}

/** 머리표를 뗀 문구 — 칩이 「사용자 몫」을 대신 말한다. */
export function stripUserTag(title: string): string {
  return title.replace(/^\s*\[(사용자[^\]]*|user[^\]]*)\]\s*/i, ""); // i18n-ignore -- 계획 파일 문법의 머리표 정규식
}

/**
 * 다음에 잡을 리프 — 문서 순서상 첫 `[ ]`, 사람 몫은 건너뛴다. `[~]` 는 다른 세션이 잡은
 * 것으로 본다 (`/oculpm:next`·`digest.rs` 와 같은 규칙).
 */
export function nextLeaf(items: readonly PlanItemDto[]): PlanItemDto | null {
  return (
    [...leafItems(items)]
      .sort((a, b) => a.order_idx - b.order_idx)
      .find((i) => i.status === "todo" && !isUserItem(i.title)) ?? null
  );
}

/** 남은 일(할 일·진행·막힘)이 하나라도 있는가. */
export function hasOpenLeaves(items: readonly PlanItemDto[]): boolean {
  return leafItems(items).some((i) => i.status === "todo" || i.status === "in_progress" || i.status === "blocked");
}

/** 「완료/전체」 — 리프 중 이월·폐기를 뺀 것이 분모다 (백엔드 진척 분모와 같다). */
export function doneOfTotal(items: readonly PlanItemDto[]): { done: number; total: number } {
  const leaves = leafItems(items).filter((i) => i.status !== "deferred" && i.status !== "dropped");
  return { done: leaves.filter((i) => i.status === "done").length, total: leaves.length };
}

/** 단계별로, 문서 순서 그대로. 각 항목에는 부모 사슬의 깊이를 붙인다. */
export function phasesOf(items: readonly PlanItemDto[]): Array<{ phase: string; items: Array<{ item: PlanItemDto; depth: number; parent: boolean }> }> {
  const byId = new Map(items.map((i) => [i.item_id, i]));
  const parents = new Set(items.map((i) => i.parent_item).filter((p): p is string => !!p));
  const depthOf = (i: PlanItemDto): number => {
    let d = 0;
    let cur = i.parent_item ? byId.get(i.parent_item) : undefined;
    while (cur && d < 4) {
      d += 1;
      cur = cur.parent_item ? byId.get(cur.parent_item) : undefined;
    }
    return d;
  };
  const out = new Map<string, Array<{ item: PlanItemDto; depth: number; parent: boolean }>>();
  for (const item of [...items].sort((a, b) => a.order_idx - b.order_idx)) {
    const key = item.phase ?? NO_PHASE;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({ item, depth: depthOf(item), parent: parents.has(item.item_id) });
  }
  return [...out.entries()].map(([phase, list]) => ({ phase, items: list }));
}
