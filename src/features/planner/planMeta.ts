/**
 * Planner 화면이 공유하는 표시 규약 — 상태 글리프·클릭 순환·롤업 가중치·날짜
 * 포맷. React 를 import 하지 않는다 (i18n 의 `t`/`getLang` 만 쓴다).
 *
 * `PlannerScreenV2` 안에 있던 것을 그대로 옮겼다 (정리 라운드 2026-09-03).
 * 화면 파일이 1400줄을 넘겨 파일 크기 래칫에 걸려 있었고, 이 상수들은 항목
 * 행(`PlanItemRow`)·본문 양쪽이 쓰는 공유 어휘라 화면에 매여 있을 이유가 없다.
 */

import { getLang, type I18nKey } from "@/i18n";
import type { PlanItemDto } from "@/lib/bindings";
import { relativeTime as formatRelativeTime } from "@/lib/format";

export const STATUS_META: Record<string, { glyph: string; labelKey: I18nKey; color: string }> = {
  todo: { glyph: "☐", labelKey: "plan.status.todo", color: "var(--text-3)" },
  in_progress: { glyph: "▣", labelKey: "plan.status.in_progress", color: "var(--accent)" },
  done: { glyph: "☑", labelKey: "plan.status.done", color: "var(--accent)" },
  // U+FE0E (text presentation selector): ⚠ 는 기본이 컬러 이모지라 나머지
  // 글리프(☐ ▣ ☑ → ✗)와 달리 OS 이모지 폰트로 그려지고 color 를 무시한다.
  blocked: { glyph: "⚠︎", labelKey: "plan.status.blocked", color: "var(--t-bug)" },
  deferred: { glyph: "→", labelKey: "plan.status.deferred", color: "var(--text-3)" },
  dropped: { glyph: "✗", labelKey: "plan.status.dropped", color: "var(--text-3)" },
};

/** A linked journal resolved to display metadata for the multi-journal picker. */
export interface JournalRefMeta {
  /** The raw ref as stored on the plan item (passed back to onOpenJournalRef). */
  ref: string;
  /** Ref with `.oculpm/`/`journal/` prefixes stripped — relative to journal root. */
  path: string;
  /** Leading path segment, e.g. "20260615". */
  workday: string;
  /** First line of the entry (real title), falling back to the file name. */
  title: string;
}

const weekdays = () => {
  const f = new Intl.DateTimeFormat(getLang(), { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(1970, 0, 4 + i))));
};

// Synthetic bucket for items written before any `## ` heading — it has no real
// heading on disk, so phase rename/delete/reorder are not offered for it.
/** 단계 없는 항목의 **그룹 키**. 표시 라벨은 `t("plan.noPhase")` 로 따로 그린다
 *  — 키를 번역하면 언어를 바꿀 때 그룹이 갈라진다. */
export const NO_PHASE = "__no_phase__";

/** "20260615" → "2026.06.15 (월)". Returns the input unchanged if not 8 digits. */
export function fmtWorkday(wd: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(wd);
  if (!m) return wd;
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return `${y}.${mo}.${d} (${weekdays()[dt.getDay()] ?? ""})`;
}

// Forward-progress click cycle; the off-path states fold back to todo.
export const NEXT_STATUS: Record<string, string> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
  blocked: "todo",
  deferred: "todo",
  dropped: "todo",
};

// 백엔드 `ItemStatus::weight` 와 같은 표다 — 막힘은 **세되 진척은 안 준다**
// (분모에서 빼면 막힌 항목이 있는 계획이 100% 로 보인다). 이월·폐기는 이
// 계획을 떠난 일이라 뺀다.
function weightOf(status: string): number | null {
  if (status === "done") return 1;
  if (status === "in_progress") return 0.5;
  if (status === "todo" || status === "blocked") return 0;
  return null; // deferred / dropped — excluded from rollup
}

/**
 * 3-depth — 하위를 가진 부모는 파생값이라 모든 집계에서 뺀다 (백엔드
 * `parent_ids()` 와 같은 규칙). 부모까지 세면 「32/35 완료」 옆에 「완료 34」
 * 가 붙는다 — 2026-09-10 화면이 실제로 그랬다.
 */
export function leafItems(items: PlanItemDto[]): PlanItemDto[] {
  const parents = new Set(items.map((i) => i.parent_item).filter((p): p is string => !!p));
  return items.filter((i) => !parents.has(i.item_id));
}

export function countByStatus(items: PlanItemDto[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const it of items) c[it.status] = (c[it.status] ?? 0) + 1;
  return c;
}

/** 쌓인 진척 바의 조각 순서 — 백엔드 진척 분모(todo·in_progress·done·blocked)와 같다. */
export const BAR_ORDER = ["done", "in_progress", "blocked", "todo"] as const;

export interface BarSegment { status: (typeof BAR_ORDER)[number]; n: number; pct: number }

/** 리프 기준 상태별 비율. 분모가 0 이면 빈 배열. */
export function progressSegments(items: PlanItemDto[]): BarSegment[] {
  const c = countByStatus(leafItems(items));
  const total = BAR_ORDER.reduce((s, k) => s + (c[k] ?? 0), 0);
  if (total === 0) return [];
  return BAR_ORDER.filter((k) => (c[k] ?? 0) > 0).map((k) => ({
    status: k,
    n: c[k],
    pct: (c[k] / total) * 100,
  }));
}

/** 「남은 일」의 정의 — 백엔드 lifecycle.rs 와 같다: todo · in_progress · blocked. */
const NEXT_RANK: Record<string, number> = { blocked: 0, in_progress: 1, todo: 2 };

export function isRemaining(status: string): boolean {
  return status in NEXT_RANK;
}

/**
 * 다음 할 일 — 막힘 → 진행중 → 할 일 순, 같은 등급 안에서는 문서 순서.
 * 막힘이 맨 앞인 이유: 그것이 사람이 풀어야 하는 일이고, 화면 아래 어딘가에
 * 묻혀 있으면 계획은 「100% 인데 안 끝난」 상태로 멈춘다.
 */
export function nextUp(items: PlanItemDto[], limit = 5): PlanItemDto[] {
  return leafItems(items)
    .map((it, i) => ({ it, i, r: NEXT_RANK[it.status] ?? -1 }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.it);
}

export type PlanView = "doc" | "board";

/** 보드 열 — 앞의 넷은 항상, 이월·폐기는 항목이 있을 때만 (`PlanBoard`). */
export const BOARD_COLUMNS = ["todo", "in_progress", "blocked", "done"] as const;
export const BOARD_OPTIONAL_COLUMNS = ["deferred", "dropped"] as const;

/** 「남은 것만」 필터 — 완료·폐기를 숨긴다 (부모는 롤업이라 하위가 다 끝나면 같이 숨는다). */
export function isHiddenWhenRemainingOnly(status: string): boolean {
  return status === "done" || status === "dropped";
}

export function phaseProgress(items: PlanItemDto[]): number {
  let sum = 0;
  let n = 0;
  for (const it of items) {
    const w = weightOf(it.status);
    if (w !== null) {
      sum += w;
      n += 1;
    }
  }
  return n === 0 ? 0 : Math.round((sum / n) * 100);
}

export function relativeTime(iso: string | null): string {
  return formatRelativeTime(iso, Date.now(), { beyondDays: 30 });
}

/** 단계 스트립의 한 조각 — 단계 하나의 리프 항목을 상태별로 센 것. */
export interface StripSegment {
  phase: string;
  /** 조각 폭의 근거 — 진척 분모(todo·in_progress·done·blocked)에 드는 리프 수. */
  n: number;
  counts: Record<(typeof BAR_ORDER)[number], number>;
}

/**
 * 단계 스트립 — 계획 전체를 한 줄로. 조각 하나가 단계 하나이고 폭은 항목 수,
 * 안의 색은 그 단계의 완료·진행·막힘이다. 「어느 단계가 막혔나」 를 스크롤
 * 없이 보게 하는 것이 이 줄의 일이다 (2026-09-10 플래너 리디자인).
 * 항목이 하나도 없는 단계는 조각이 없다 — 0 폭 조각은 보이지도 눌리지도 않는다.
 */
export function phaseStrip(phases: readonly [string, PlanItemDto[]][]): StripSegment[] {
  const out: StripSegment[] = [];
  for (const [phase, items] of phases) {
    const c = countByStatus(leafItems(items));
    const counts = { done: c.done ?? 0, in_progress: c.in_progress ?? 0, blocked: c.blocked ?? 0, todo: c.todo ?? 0 };
    const n = counts.done + counts.in_progress + counts.blocked + counts.todo;
    if (n > 0) out.push({ phase, n, counts });
  }
  return out;
}
