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
  EntryFilters,
  JournalEntry,
  JournalEntrySummary,
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
} as const;

export type OculpmApi = typeof oculpmApi;
