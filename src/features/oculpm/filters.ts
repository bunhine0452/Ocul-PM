/**
 * `CategoryFilter` — the UI-level filter shape backing `CategoryFilterBar`.
 *
 * Two distinct shapes coexist:
 *  - `CategoryFilter` (this module): in-memory React state. `types` is a
 *    `Set<EntryType>` for O(1) chip-toggle membership.
 *  - `EntryFilters` (specta-generated `bindings.ts`): the wire DTO sent to
 *    `oculpm_list_journal_entries`. `types` is a sorted array; `search` is
 *    nullable (vs. empty string in the UI).
 *
 * `toEntryFilters` is the single boundary that converts one to the other —
 * keep all snake_case / null-collapse logic here so TimelineView only sees
 * the canonical `EntryFilters`.
 *
 * Persistence is per-project in `localStorage` (see PR8 §2). The single
 * project key avoids the cross-project bleed we'd get with a workspace-wide
 * filter, and survives WorkspaceContext schema bumps (which only own the
 * `aipm:workspace:v1` envelope).
 *
 * See `docs/major_update/oculpm/W3/PR8-category-filter.md`.
 */

import type { EntryFilters, EntryType } from "@/lib/bindings";

export const ALL_ENTRY_TYPES: ReadonlyArray<EntryType> = [
  "bug",
  "feature",
  "error",
  "refactor",
  "chore",
];

export interface CategoryFilter {
  /** Empty set = show all types. */
  types: Set<EntryType>;
  verifiedOnly: boolean;
  /** Reserved for W4. Toggle is rendered disabled — keep the field for the
   * round-trip so a future W4 PR only flips one boolean to enable it. */
  mismatchOnly: boolean;
  /** `checkbox === false` OR `status !== "done"` (backend definition). */
  unfinishedOnly: boolean;
  /** Trimmed before sending to backend. Empty → `null` filter. */
  search: string;
}

export const DEFAULT_FILTER: CategoryFilter = Object.freeze({
  types: new Set<EntryType>(),
  verifiedOnly: false,
  mismatchOnly: false,
  unfinishedOnly: false,
  search: "",
});

/** True if the filter would return every entry (i.e., no active constraint). */
export function isFilterEmpty(filter: CategoryFilter): boolean {
  return (
    filter.types.size === 0 &&
    !filter.verifiedOnly &&
    !filter.mismatchOnly &&
    !filter.unfinishedOnly &&
    filter.search.trim().length === 0
  );
}

/** Convert UI filter → backend DTO. */
export function toEntryFilters(filter: CategoryFilter): EntryFilters {
  const trimmed = filter.search.trim();
  return {
    types: [...filter.types].sort(),
    verified_only: filter.verifiedOnly,
    mismatch_only: filter.mismatchOnly,
    unfinished_only: filter.unfinishedOnly,
    search: trimmed.length > 0 ? trimmed : null,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────

function storageKey(projectId: number): string {
  return `oculpm.filter.${projectId}`;
}

interface SerializedFilter {
  types: EntryType[];
  verifiedOnly: boolean;
  mismatchOnly: boolean;
  unfinishedOnly: boolean;
  search: string;
}

function isValidEntryType(s: unknown): s is EntryType {
  return (
    typeof s === "string" &&
    (ALL_ENTRY_TYPES as readonly string[]).includes(s)
  );
}

/** Load filter for a project; on missing/corrupt → DEFAULT_FILTER. */
export function loadFilter(projectId: number): CategoryFilter {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (raw == null) return cloneDefault();
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      console.warn(`oculpm filter for project ${projectId} corrupt — using default`);
      return cloneDefault();
    }
    const p = parsed as Partial<SerializedFilter>;
    const types = new Set<EntryType>(
      Array.isArray(p.types) ? p.types.filter(isValidEntryType) : [],
    );
    return {
      types,
      verifiedOnly: typeof p.verifiedOnly === "boolean" ? p.verifiedOnly : false,
      mismatchOnly: typeof p.mismatchOnly === "boolean" ? p.mismatchOnly : false,
      unfinishedOnly:
        typeof p.unfinishedOnly === "boolean" ? p.unfinishedOnly : false,
      search: typeof p.search === "string" ? p.search : "",
    };
  } catch (err) {
    console.warn(
      `oculpm filter for project ${projectId} unparseable — using default`,
      err,
    );
    return cloneDefault();
  }
}

/** Persist (or remove if equivalent to default) the filter for a project. */
export function saveFilter(projectId: number, filter: CategoryFilter): void {
  try {
    if (isFilterEmpty(filter)) {
      localStorage.removeItem(storageKey(projectId));
      return;
    }
    const payload: SerializedFilter = {
      types: [...filter.types].sort(),
      verifiedOnly: filter.verifiedOnly,
      mismatchOnly: filter.mismatchOnly,
      unfinishedOnly: filter.unfinishedOnly,
      search: filter.search,
    };
    localStorage.setItem(storageKey(projectId), JSON.stringify(payload));
  } catch (err) {
    // Quota / privacy mode — non-fatal, filter still works in-memory.
    console.warn(`oculpm filter for project ${projectId} save failed`, err);
  }
}

function cloneDefault(): CategoryFilter {
  return {
    types: new Set<EntryType>(),
    verifiedOnly: false,
    mismatchOnly: false,
    unfinishedOnly: false,
    search: "",
  };
}
