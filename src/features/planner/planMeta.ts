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

function weightOf(status: string): number | null {
  if (status === "done") return 1;
  if (status === "in_progress") return 0.5;
  if (status === "todo") return 0;
  return null; // blocked / deferred / dropped — excluded from rollup
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
