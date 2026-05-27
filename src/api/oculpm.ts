/**
 * `oculpmApi` — thin wrapper over the 18 `commands.oculpm*` invocations
 * exported by the specta-generated `bindings.ts`.
 *
 * Why a wrapper:
 *  1. Collapses the `{ status: "ok" | "error" }` `typedError` envelope into
 *     "resolve on ok, reject `OculpmApiError` on error" — call sites stay
 *     readable and React Query / toast handlers get real `Error`s.
 *  2. Centralises argument-name conversion (`null` for absent `Option<T>`
 *     args, snake_case for filter DTOs the backend expects).
 *  3. Gives every screen (TodayScreen, OculpmSettings, OnboardingModal) one
 *     import path so the frontend never reaches into `bindings.ts` directly.
 *
 * See `docs/major_update/oculpm/W3/PR4-frontend-context.md` §1.
 */

import { commands } from "@/lib/bindings";
import type {
  AgentDetection,
  AgentSyncReport,
  Difficulty,
  EntryFilters,
  EntryStatus,
  JournalEntry,
  JournalEntrySummary,
  LayerComparison,
  ManualEntryDraft,
  OculpmConfig,
  OculpmInitReport,
  OculpmStatus,
  ReindexReport,
  Session,
  FileChangeEvent,
  Snapshot,
  SnapshotKind,
  WatcherStatus,
} from "@/lib/bindings";

/** Error subclass so toasts / fallbacks can narrow on `instanceof OculpmApiError`. */
export class OculpmApiError extends Error {
  readonly command: string;
  constructor(command: string, message: string) {
    super(message);
    this.name = "OculpmApiError";
    this.command = command;
  }
}

type Envelope<T> = { status: "ok"; data: T } | { status: "error"; error: string };

async function unwrap<T>(command: string, p: Promise<Envelope<T>>): Promise<T> {
  const res = await p;
  if (res.status === "ok") return res.data;
  throw new OculpmApiError(command, res.error);
}

// ─────────────────────────────────────────────────────────────────────────────
// W1 — init / config / status
// ─────────────────────────────────────────────────────────────────────────────

export const oculpmApi = {
  init: (projectId: number) =>
    unwrap<OculpmInitReport>("oculpm_init", commands.oculpmInit(projectId)),

  getStatus: (projectId: number) =>
    unwrap<OculpmStatus>("oculpm_get_status", commands.oculpmGetStatus(projectId)),

  getConfig: (projectId: number) =>
    unwrap<OculpmConfig>("oculpm_get_config", commands.oculpmGetConfig(projectId)),

  setConfig: (projectId: number, newConfig: OculpmConfig) =>
    unwrap<null>("oculpm_set_config", commands.oculpmSetConfig(projectId, newConfig)),

  // ─── W2 — sessions / file_changes / snapshots / watcher ───────────────

  getCurrentSession: (projectId: number) =>
    unwrap<Session | null>(
      "oculpm_get_current_session",
      commands.oculpmGetCurrentSession(projectId)
    ),

  startSessionManual: (projectId: number) =>
    unwrap<Session | null>(
      "oculpm_start_session_manual",
      commands.oculpmStartSessionManual(projectId)
    ),

  endSessionManual: (projectId: number, sessionId: string) =>
    unwrap<null>(
      "oculpm_end_session_manual",
      commands.oculpmEndSessionManual(projectId, sessionId)
    ),

  listSessions: (projectId: number, workday?: string) =>
    unwrap<Session[]>(
      "oculpm_list_sessions",
      commands.oculpmListSessions(projectId, workday ?? null)
    ),

  getFileChanges: (projectId: number, workday: string, sessionId?: string) =>
    unwrap<FileChangeEvent[]>(
      "oculpm_get_file_changes",
      commands.oculpmGetFileChanges(projectId, workday, sessionId ?? null)
    ),

  getIndexSnapshot: (projectId: number, workday: string, kind: SnapshotKind) =>
    unwrap<Snapshot>(
      "oculpm_get_index_snapshot",
      commands.oculpmGetIndexSnapshot(projectId, workday, kind)
    ),

  watcherStart: (projectId: number) =>
    unwrap<null>("oculpm_watcher_start", commands.oculpmWatcherStart(projectId)),

  watcherStop: (projectId: number) =>
    unwrap<null>("oculpm_watcher_stop", commands.oculpmWatcherStop(projectId)),

  watcherStatus: (projectId: number) =>
    unwrap<WatcherStatus>(
      "oculpm_watcher_status",
      commands.oculpmWatcherStatus(projectId)
    ),

  // ─── W3-PR3 — journal cache + manual entry ─────────────────────────────

  listJournalEntries: (
    projectId: number,
    workday?: string,
    filters?: EntryFilters
  ) =>
    unwrap<JournalEntrySummary[]>(
      "oculpm_list_journal_entries",
      commands.oculpmListJournalEntries(projectId, workday ?? null, filters ?? null)
    ),

  getJournalEntry: (projectId: number, relativePath: string) =>
    unwrap<JournalEntry | null>(
      "oculpm_get_journal_entry",
      commands.oculpmGetJournalEntry(projectId, relativePath)
    ),

  setJournalVerified: (
    projectId: number,
    relativePath: string,
    verified: boolean
  ) =>
    unwrap<null>(
      "oculpm_set_journal_verified",
      commands.oculpmSetJournalVerified(projectId, relativePath, verified)
    ),

  reindexCache: (projectId: number) =>
    unwrap<ReindexReport>("oculpm_reindex_cache", commands.oculpmReindexCache(projectId)),

  createManualEntry: (projectId: number, draft: ManualEntryDraft) =>
    unwrap<JournalEntry>(
      "oculpm_create_manual_entry",
      commands.oculpmCreateManualEntry(projectId, draft)
    ),

  // ─── W3 follow-up — inline edit for difficulty / status ────────────────

  /**
   * Inline-edit `difficulty` and/or `status` on an existing entry. Pass
   * `null` for a parameter to leave it unchanged.
   *
   * `difficulty` semantics — three values:
   *   - `null` / omitted: don't touch the field
   *   - `{ kind: "clear" }`: write `difficulty: null` to the frontmatter
   *   - `{ kind: "set", value: "high" }`: set to that level
   *
   * The backend returns the hydrated entry so the caller can update its
   * optimistic state without a second `getJournalEntry` round-trip.
   */
  updateEntryMeta: (
    projectId: number,
    relativePath: string,
    opts: {
      difficulty?: { kind: "clear" } | { kind: "set"; value: Difficulty } | null;
      status?: EntryStatus | null;
    },
  ) => {
    const difficultyChange =
      opts.difficulty == null
        ? null
        : opts.difficulty.kind === "clear"
          ? { value: null }
          : { value: opts.difficulty.value };
    return unwrap<JournalEntry>(
      "oculpm_update_entry_meta",
      commands.oculpmUpdateEntryMeta(
        projectId,
        relativePath,
        difficultyChange,
        opts.status ?? null,
      ),
    );
  },

  // ─── W4 — agent adapter sync + detect + drift / layer comparison ───────

  syncAgents: (projectId: number) =>
    unwrap<AgentSyncReport>(
      "oculpm_agents_sync_active",
      commands.oculpmAgentsSyncActive(projectId),
    ),

  detectAgents: (projectId: number) =>
    unwrap<AgentDetection[]>(
      "oculpm_agents_detect",
      commands.oculpmAgentsDetect(projectId),
    ),

  /**
   * W4 dogfooding follow-up (2026-05-26) — return the project's master template
   * text. Backs the DiffVsNarrative "프롬프트 복사" action, which is intentionally
   * separated from `syncAgents` so the user can distinguish between
   * "re-render AGENTS.md" (file write, idempotent) and "copy the rules so I
   * can paste them into a running chat" (one-shot, easy to over-do).
   */
  getMasterTemplate: (projectId: number) =>
    unwrap<string>(
      "oculpm_agents_get_master_template",
      commands.oculpmAgentsGetMasterTemplate(projectId),
    ),

  /**
   * W4-PR5 — diff a session's index ndjson against the union of journal
   * `files_touched` paths. Backend strips forbidden + redacted entries from
   * both sides so callers can render `matched / only_in_index / only_in_journal`
   * directly. See `docs/major_update/oculpm/W4/PR5-compare-layers.md`.
   */
  compareLayers: (projectId: number, sessionId: string) =>
    unwrap<LayerComparison>(
      "oculpm_compare_layers",
      commands.oculpmCompareLayers(projectId, sessionId),
    ),

  /**
   * W4 dogfooding (2026-05-27) — overwrite the body markdown of an entry.
   * Frontmatter survives untouched; the backend re-parses + cache-upserts
   * and returns the hydrated entry so the detail pane can resync.
   */
  updateEntryBody: (
    projectId: number,
    relativePath: string,
    bodyMarkdown: string,
  ) =>
    unwrap<JournalEntry>(
      "oculpm_update_entry_body",
      commands.oculpmUpdateEntryBody(projectId, relativePath, bodyMarkdown),
    ),

  /**
   * W4 dogfooding (2026-05-27) — open a journal entry .md in the OS default
   * editor, bypassing the opener plugin's glob scope (which has regressed
   * three times during dogfooding). Backend resolves the absolute path and
   * shells out directly.
   */
  openEntryInEditor: (projectId: number, relativePath: string) =>
    unwrap<null>(
      "oculpm_open_entry_in_editor",
      commands.oculpmOpenEntryInEditor(projectId, relativePath),
    ),
} as const;

export type OculpmApi = typeof oculpmApi;
