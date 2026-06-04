/**
 * Pure helpers for `MigrationModal`. Kept here (not inlined into the modal
 * component) so step 2's toggle math stays unit-testable from Vitest in W6
 * without rendering the modal.
 */

import type { MigrationEntryPlan, MigrationPlan, MigrationWorkdayPlan } from "@/lib/bindings";

/** Total entries the migration would actually write (`will_skip === false`). */
export function countToWrite(plan: MigrationPlan): number {
  let n = 0;
  for (const w of plan.by_workday) {
    for (const e of w.entries) if (!e.will_skip) n += 1;
  }
  return n;
}

/** Total entries the user toggled off (`will_skip === true`). */
export function countSkipped(plan: MigrationPlan): number {
  return plan.source_entry_count - countToWrite(plan);
}

/** Count of entries whose `forbidden_files` is non-empty. UI uses this to
 *  surface the "민감 경로 포함" badge in step 1's summary. */
export function countForbiddenEntries(plan: MigrationPlan): number {
  let n = 0;
  for (const w of plan.by_workday) {
    for (const e of w.entries) if (e.forbidden_files.length > 0) n += 1;
  }
  return n;
}

/** Toggle a single entry's `will_skip` flag. Returns a new plan; the
 *  original is untouched so React state updates correctly. */
export function togglePlanEntry(
  plan: MigrationPlan,
  sourceEntryId: number,
): MigrationPlan {
  return {
    ...plan,
    by_workday: plan.by_workday.map((w) => ({
      ...w,
      entries: w.entries.map((e) =>
        e.source_entry_id === sourceEntryId ? { ...e, will_skip: !e.will_skip } : e,
      ),
    })),
  };
}

/** Set `will_skip` for every entry in `workday`. Used by the workday header's
 *  "전부 선택 / 해제" buttons in step 2. */
export function setWorkdayWillSkip(
  plan: MigrationPlan,
  workday: string,
  willSkip: boolean,
): MigrationPlan {
  return {
    ...plan,
    by_workday: plan.by_workday.map((w) =>
      w.workday !== workday
        ? w
        : { ...w, entries: w.entries.map((e) => ({ ...e, will_skip: willSkip })) },
    ),
  };
}

/** Format a byte count for the backup-confirm step. We cap at MB granularity
 *  — sub-MB sizes are rare for a real migration and "0 MB" looks worse than
 *  "< 1 MB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  if (kb >= 1) return `${kb.toFixed(0)} KB`;
  return `${bytes} B`;
}

/** "20260522" → "2026-05-22" (no day-of-week — keep the cell compact). */
export function formatWorkdayDate(workday: string): string {
  if (workday.length !== 8) return workday;
  return `${workday.slice(0, 4)}-${workday.slice(4, 6)}-${workday.slice(6, 8)}`;
}

/** "0900_bug_x.md" → "09:00". Used in step 2's entry rows so the user can
 *  recognise the time they were working without expanding the .md path. */
export function extractHHMMFromPath(target_relative_path: string): string {
  const base = target_relative_path.split("/").pop() ?? "";
  const m = /^(\d{2})(\d{2})_/.exec(base);
  if (!m) return "—";
  return `${m[1]}:${m[2]}`;
}

/** Sum of `synthetic_session_count` across all workdays. Step 1 surfaces
 *  this as "총 N 개 세션으로 재구성" so the user knows the migration is not
 *  a flat dump. */
export function totalSyntheticSessionCount(plan: MigrationPlan): number {
  return plan.by_workday.reduce((acc, w) => acc + w.synthetic_session_count, 0);
}

/** Look up a workday plan by key. Returns `undefined` if not found. */
export function findWorkdayPlan(
  plan: MigrationPlan,
  workday: string,
): MigrationWorkdayPlan | undefined {
  return plan.by_workday.find((w) => w.workday === workday);
}

/** Sorted workdays — most recent first (matches the way Today screen lists
 *  days, and "지난 며칠치만 마이그레이션" intuition). */
export function sortedWorkdays(plan: MigrationPlan): MigrationWorkdayPlan[] {
  return [...plan.by_workday].sort((a, b) => b.workday.localeCompare(a.workday));
}

/** Entries within a workday sorted by hhmm in the target path. */
export function sortedEntries(workday: MigrationWorkdayPlan): MigrationEntryPlan[] {
  return [...workday.entries].sort((a, b) =>
    a.target_relative_path.localeCompare(b.target_relative_path),
  );
}
