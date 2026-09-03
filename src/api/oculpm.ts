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

import { commands, events } from "@/lib/bindings";
import { ApiError, call, toAppError, type Envelope } from "@/api/invoke";
import type {
  A2aOverview,
  Group,
  A2aServerStatus,
  OculpmA2aChanged,
  OculpmA2aTrespass,
  Task,
  AgentDetection,
  AgentSyncReport,
  BackfillReport,
  Difficulty,
  EntryFileDiff,
  EntryFilters,
  EntryStatus,
  JournalEntry,
  JournalEntrySummary,
  LayerComparison,
  WorkdayComparison,
  AppError,
  ManualEntryDraft,
  OculpmConfig,
  OculpmInitReport,
  OculpmStatus,
  CodexPluginStatus,
  CodexRegistrationStatus,
  ReindexReport,
  Session,
  FileChangeEvent,
  OculpmFileChanged,
} from "@/lib/bindings";

/**
 * Error subclass so toasts / fallbacks can narrow on `instanceof OculpmApiError`.
 * Phase 4: `ApiError` 의 특수화 — `code`/`detail` 이 붙었다 (`e.message` 는 그대로).
 */
export class OculpmApiError extends ApiError {
  constructor(command: string, error: AppError) {
    super(command, error);
    this.name = "OculpmApiError";
  }
}

async function unwrap<T>(command: string, p: Promise<Envelope<T>>): Promise<T> {
  try {
    return await call(command, p);
  } catch (e) {
    throw e instanceof ApiError
      ? new OculpmApiError(e.command, e.toAppError())
      : new OculpmApiError(command, toAppError(e));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// W1 — init / config / status
// ─────────────────────────────────────────────────────────────────────────────

export const oculpmApi = {
  // ─── Codex MCP — Claude `.mcp.json`과 독립된 `~/.codex/config.toml` ───

  codexMcpStatus: (projectId: number) =>
    unwrap<CodexRegistrationStatus>("codex_mcp_status", commands.codexMcpStatus(projectId)),

  codexMcpRegister: (projectId: number) =>
    unwrap<CodexRegistrationStatus>("codex_mcp_register", commands.codexMcpRegister(projectId)),

  codexMcpUnregister: (projectId: number) =>
    unwrap<CodexRegistrationStatus>("codex_mcp_unregister", commands.codexMcpUnregister(projectId)),

  /** Codex 플러그인 설치 상태 (머신 스코프, 읽기 전용 — 설치는 `codex plugin` CLI). */
  codexPluginStatus: () =>
    unwrap<CodexPluginStatus>("codex_plugin_status", commands.codexPluginStatus()),

  // ─── A2A — 협업 상태 (docs/a2a/00-master-plan.md §9) ──────────────────
  /** 참여자·잡힌 구역·미완 태스크를 **한 시각으로** 한 번에. */
  a2aOverview: (projectId: number) =>
    unwrap<A2aOverview>("a2a_overview", commands.a2aOverview(projectId)),

  /** 고른 세션들을 한 팀으로 묶는다 — 묶여야 서로 말할 수 있다. */
  a2aBindGroup: (projectId: number, title: string, members: string[]) =>
    unwrap<Group>("a2a_bind_group", commands.a2aBindGroup(projectId, title, members)),

  /** 팀의 멤버를 갈아 끼운다 (둘 미만은 해체이지 갱신이 아니다). */
  a2aSetGroupMembers: (projectId: number, groupId: string, members: string[]) =>
    unwrap<Group>("a2a_set_group_members", commands.a2aSetGroupMembers(projectId, groupId, members)),

  /** 팀을 푼다. */
  a2aDissolveGroup: (projectId: number, groupId: string) =>
    unwrap<boolean>("a2a_dissolve_group", commands.a2aDissolveGroup(projectId, groupId)),

  /** 넘어온 작업을 사람이 수락/거절한다 — 자동 수락은 없다(D5). */
  a2aDecideTask: (projectId: number, taskId: string, accept: boolean) =>
    unwrap<Task>("a2a_decide_task", commands.a2aDecideTask(projectId, taskId, accept)),

  /** 주인이 사라졌는데 기한이 남은 구역을 사용자가 놓아 준다. */
  a2aReleaseLease: (projectId: number, leaseId: string) =>
    unwrap<boolean>("a2a_release_lease", commands.a2aReleaseLease(projectId, leaseId)),

  init: (projectId: number) =>
    unwrap<OculpmInitReport>("oculpm_init", commands.oculpmInit(projectId)),

  getStatus: (projectId: number) =>
    unwrap<OculpmStatus>("oculpm_get_status", commands.oculpmGetStatus(projectId)),

  getConfig: (projectId: number) =>
    unwrap<OculpmConfig>("oculpm_get_config", commands.oculpmGetConfig(projectId)),

  setConfig: (projectId: number, newConfig: OculpmConfig) =>
    unwrap<null>("oculpm_set_config", commands.oculpmSetConfig(projectId, newConfig)),

  // ─── W2 — sessions / file_changes / snapshots / watcher ───────────────

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

  watcherStart: (projectId: number) =>
    unwrap<null>("oculpm_watcher_start", commands.oculpmWatcherStart(projectId)),

  watcherStop: (projectId: number) =>
    unwrap<null>("oculpm_watcher_stop", commands.oculpmWatcherStop(projectId)),

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

  /** Per-file diffs recorded when this entry was first indexed. `[]` when none
   *  were captured (entry predates the feature, non-git project, or written
   *  after committing). */
  getEntryDiffs: (projectId: number, relativePath: string) =>
    unwrap<EntryFileDiff[]>(
      "oculpm_get_entry_diffs",
      commands.oculpmGetEntryDiffs(projectId, relativePath)
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

  /** F7a-B Unit B — write the tz-offset coercion into the on-disk frontmatter
   * once (timestamps only). Returns the re-projected entry. */
  coerceEntryOnDisk: (projectId: number, relativePath: string) =>
    unwrap<JournalEntry>(
      "oculpm_coerce_entry_on_disk",
      commands.oculpmCoerceEntryOnDisk(projectId, relativePath),
    ),

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
   * text. Intentionally separate from `syncAgents` so the user can distinguish
   * between "re-render AGENTS.md" (file write, idempotent) and "copy the rules
   * so I can paste them into a running chat" (one-shot, easy to over-do).
   */
  getMasterTemplate: (projectId: number) =>
    unwrap<string>(
      "oculpm_agents_get_master_template",
      commands.oculpmAgentsGetMasterTemplate(projectId),
    ),

  /**
   * W4-PR5 — diff a session's index ndjson against the union of journal
   * `files_touched` paths. Backend strips forbidden + redacted entries from
   * both sides so callers can render the result directly.
   * See `docs/major_update/oculpm/W4/PR5-compare-layers.md`.
   *
   * Two views come back and they answer different questions:
   * - `matched` / `only_in_index` / `only_in_journal` / `jaccard_index` join on
   *   an **exact `session_id`** — precise only when the agent stamps the
   *   watcher's own scheme.
   * - `unrecorded` / `unrecorded_severity` measure **workday coverage** — the
   *   honest "no journal mentions this file" answer, immune to agents that
   *   mint their own ids (`manual-20260820-205400`). Use these for anything
   *   user-facing (dogfooding 2026-08-20).
   */
  compareLayers: (projectId: number, sessionId: string) =>
    unwrap<LayerComparison>(
      "oculpm_compare_layers",
      commands.oculpmCompareLayers(projectId, sessionId),
    ),

  /** 워크데이 하나의 정직성 감사 — 세션 전부를 IPC 1회에 (Phase 3). */
  compareWorkday: (projectId: number, workday: string) =>
    unwrap<WorkdayComparison>(
      "oculpm_compare_workday",
      commands.oculpmCompareWorkday(projectId, workday),
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

  /**
   * F5 — synthesise journal entries from recent git history (cold-start
   * backfill). Idempotent: re-running only adds commits not seen before.
   */
  backfillFromGit: (projectId: number, maxCommits: number) =>
    unwrap<BackfillReport>(
      "oculpm_backfill_from_git",
      commands.oculpmBackfillFromGit(projectId, maxCommits),
    ),

  /**
   * 워처의 파일 변경 스트림 구독. 반환값은 구독 해제 함수다.
   *
   * 이벤트라 봉투(`{status}`)가 없으니 여기서 접을 오류도 없다 — 래퍼가 하는
   * 일은 위 3번(화면이 생성 파일을 직접 만지지 않는다)과, 비-Tauri 컨텍스트
   * (jsdom·헤드리스)에서 **조용히 아무것도 안 하는 것**이다. 구독 실패로
   * 화면이 죽어서는 안 된다 — 라이브 갱신만 없는 상태로 두면 된다.
   */
  /** 외부 A2A 문의 상태 (기본 꺼짐). */
  a2aEndpointStatus: () =>
    unwrap<A2aServerStatus>("a2a_endpoint_status", commands.a2aEndpointStatus()),

  /** 문을 연다 — 응답의 토큰은 **이번 기동 동안만** 유효하고 디스크에 안 남는다. */
  a2aEndpointStart: (projectId: number) =>
    unwrap<A2aServerStatus>("a2a_endpoint_start", commands.a2aEndpointStart(projectId)),

  a2aEndpointStop: () =>
    unwrap<A2aServerStatus>("a2a_endpoint_stop", commands.a2aEndpointStop()),

  /** A2A 원장(참여자·우편함·태스크)이 바뀌었다. 구독 해제 함수를 돌려준다. */
  onA2aChanged: (cb: (payload: OculpmA2aChanged) => void): Promise<() => void> => {
    try {
      return events.oculpmA2aChanged.listen(({ payload }) => cb(payload)).catch(() => () => {});
    } catch {
      return Promise.resolve(() => {});
    }
  },

  /** 남의 구역을 밟았다는 경고. */
  onA2aTrespass: (cb: (payload: OculpmA2aTrespass) => void): Promise<() => void> => {
    try {
      return events.oculpmA2aTrespass.listen(({ payload }) => cb(payload)).catch(() => () => {});
    } catch {
      return Promise.resolve(() => {});
    }
  },

  onFileChanged: (cb: (payload: OculpmFileChanged) => void): Promise<() => void> => {
    try {
      return events.oculpmFileChanged
        .listen(({ payload }) => cb(payload))
        .catch(() => () => {});
    } catch {
      return Promise.resolve(() => {});
    }
  },
} as const;

export type OculpmApi = typeof oculpmApi;
