/**
 * WorkspaceContext — 앱 전역 상태의 단일 컨텍스트 (MASTER-GUIDE §6.1)
 *
 * 원칙:
 * - localStorage 접근은 이 파일 안에서만 (eslint rule로 강제)
 * - 영속화 키: "aipm:workspace:v1" 단일 키 + JSON
 * - 마이그레이션 함수로 기존 12개 키 자동 흡수 후 삭제
 */
import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

import { events, type FileOp, type OculpmStatus, type Session } from "@/lib/bindings";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { toast, DriftCooldown } from "@/lib/toast";

// ---------- State Shape ----------

/**
 * Lite-W6 PR7 (Part 1) narrows the IA: "overview" (absorbed into Today
 * per 04-ui-ux §2) and "changelog" (PR4 retired the route) both leave
 * the union. "code" stays accessible until PR8/PR9 absorb its FileTree
 * and AI parts. Persisted values for the removed routes fall back to
 * "today" inside `loadFromStorage` + `mapLegacyTab`.
 */
export type ActiveView = "today" | "plan" | "code";
export type AiWorkbenchMode = "quick-edit" | "chat";

/**
 * Lite-W6 PR8 Part 1: FileTree change-highlight marker. The watcher's
 * `FileOp` collapses into three categories the explorer renders as dot +
 * badge. See `mapFileOpToChangeOp` for the projection.
 */
export type ChangeOp = "A" | "M" | "D";

export type SidePanelMode = "files" | "diff";

// ─── Final UI Update (ui_v2) — read-compat scaffolding (PR-UI 0) ──────────
// These additive types/fields let PR-UI 1+ screens round-trip their state
// immediately. They are persisted as additive fields (no schema bump — see the
// WORKSPACE_SCHEMA_VERSION note below), and NO key deletion / write-migration
// happens yet (that lands in PR-UI 7). Theme is intentionally absent here:
// SettingsContext remains the single source of truth for theme (Final UI
// Update decision A, 2026-05-31).
/**
 * The 8 ui_v2 screens (01-ia-and-shell.md §1.2). Tracked in a SEPARATE field
 * from the legacy `activeView` ("today" | "plan" | "code") so the legacy union
 * and its write-migration stay untouched until PR-UI 7. flag-off never reads
 * this field.
 */
export type UiV2View =
  | "today"
  | "journal"
  | "diff"
  | "planner"
  | "search"
  | "terminal"
  | "ai"
  | "graph"
  | "docs"
  | "settings";
export type JournalFilter =
  | "all"
  | "feature"
  | "bugfix"
  | "refactor"
  | "error"
  | "chore";
export type DiffMode = "unified" | "split";
export type SearchScope = "semantic" | "symbol" | "text";
export interface TerminalTab {
  id: string;
  label: string;
  shell: string;
  cwd: string;
}

export interface RecentChange {
  /** Project-relative forward-slash path (matches `ProjectTreeNode.relative_path`). */
  path: string;
  op: ChangeOp;
  /** Unix milliseconds when we ingested the event. Used only for ordering. */
  ts: number;
  /**
   * Lite-W6 PR6.5: read/unread flag for the LocalDiffView. New watcher events
   * start as `false`; viewing the diff body in LocalDiffView flips it to
   * `true` (one-way per change — re-running the watcher event resets to
   * unread). Legacy persisted entries (pre-PR6.5) without this field are
   * read as `true` during `loadFromStorage` so old changes don't suddenly
   * scream for attention.
   */
  read: boolean;
}

// Legacy tab names for migration
type LegacyTab = "files" | "chat" | "assist" | "graph" | "planner" | "settings" | "diagnostics" | "terminal" | "git" | "overview" | "today";

export interface WorkspaceState {
  // Project
  currentProjectId: number | null;
  currentProjectName: string | null;
  currentProjectRoot: string | null;

  // Legacy IA view ("today" | "plan" | "code") — retained for v1/v2 migration
  // compatibility; ui_v2 routes screens via `uiV2View` (PR-UI 7).
  activeView: ActiveView;

  // Code sub-state
  openFiles: string[];
  activeFile: string | null;
  aiWorkbenchMode: AiWorkbenchMode;
  /**
   * Lite-W6 PR9: AI panel as a Workspace-level overlay (⌘\). Replaces the
   * old `aiWorkbenchOpen` field which only controlled the Code view's right
   * sidebar — the new flag governs the cross-view overlay. Legacy persisted
   * values for `aiWorkbenchOpen` are dropped during load.
   */
  aiOverlayOpen: boolean;

  // File explorer expanded state
  fileExplorerExpanded: Record<string, boolean>;

  /**
   * Lite-W6 PR8 Part 1: FIFO buffer of watcher-observed changes for the
   * current project. Capped at `RECENT_CHANGES_CAP` (1000) to bound memory
   * growth during long sessions. Cleared on project switch.
   */
  recentChanges: RecentChange[];

  /** Pixel width. Clamped to [`SIDE_PANEL_MIN_WIDTH`, `SIDE_PANEL_MAX_WIDTH`]. */
  sidePanelWidth: number;
  /**
   * Lite-W6 PR6.3: which surface the side panel shows.
   *  - `"files"` — FileExplorer (default).
   *  - `"diff"`  — LocalDiffView (recentChanges + computeDiff).
   * Persisted so the user keeps their last context when they re-open ⌘B.
   */
  sidePanelMode: SidePanelMode;

  // Persistence schema (1: pre-W3; 2: defaultTab promoted to today).
  schemaVersion: number;
  /**
   * If true the user has explicitly chosen a tab via the IA strip — we
   * leave their choice alone during the v1→v2 migration. Set by
   * `setActiveView` after the user picks a tab.
   */
  defaultTabUserOverride: boolean;

  // Volatile (not persisted)
  indexingProjectId: number | null;
  indexProgress: IndexProgress | null;

  /**
   * Lite-W6 PR6.4: one-shot handoff target for the FileTree → Diff jump.
   * Set when a user clicks a changed-file dot in FileExplorer; LocalDiffView
   * reads it on mount + clears so we don't snap back to it on every render.
   * Not persisted — handoff is a single event, not a sticky state.
   */
  diffTarget: string | null;

  // .oculpm/ — populated by event listeners + on-demand fetches (W3-PR4).
  // Volatile: re-derived on project switch.
  oculpmEnabled: boolean;
  oculpmStatus: OculpmStatus | null;
  currentSession: Session | null;
  /** `YYYYMMDD` per project workday tz. Updated on `workday_boundary`. */
  workdayKey: string | null;

  // ─── Final UI Update (ui_v2) read-compat fields (PR-UI 0) ───────────────
  /** 활성 ui_v2 화면 (사이드바 9 슬롯 중 화면 8개). flag-off 는 읽지 않음. */
  uiV2View: UiV2View;
  /** 작업 일지 화면의 trigger 필터. */
  journalFilter: JournalFilter;
  /** 변경 diff 화면에서 마지막으로 본 파일 경로. */
  diffActivePath: string | null;
  /** "검토 완료" 표시된 파일 경로들. */
  diffReadPaths: string[];
  /** 변경 diff 통합/분할 보기 모드. */
  diffMode: DiffMode;
  /** Planner goal 카드 펼침 상태 (goalId → open). */
  plannerOpen: Record<string, boolean>;
  /**
   * 마지막으로 본 Planner 계획 id. 일지로 이동했다가 뒤로가기로 돌아왔을 때
   * 같은 계획을 복원하기 위해 영속. (PlannerScreenV2 는 remount 시 이 값으로
   * selectedId 를 초기화한다.)
   */
  plannerPlanId: string | null;
  /** 코드 검색 scope. */
  searchScope: SearchScope;
  /** 최근 검색어 (최대 10개). */
  searchRecent: string[];
  /** 터미널 탭 목록 (PTY 핸들은 휘발성 — 여기엔 메타만). */
  terminalTabs: TerminalTab[];
  /** 활성 터미널 탭 id. */
  terminalActiveId: string | null;
  /** AI 패널 활성 모델 id. */
  aiActiveModel: string | null;
  /** AI 패널 + 오버레이가 공유하는 thread id. */
  aiThreadId: string | null;
  /** 문서(docs) 화면에서 마지막으로 본 문서의 프로젝트-루트 기준 경로 (예: docs/README.md). */
  docsActivePath: string | null;
  /**
   * 사이드바 접힘 상태 (Dogfooding 2026-06-07). true 면 사이드바가 화면에서
   * 사라지고, 좌측 가장자리 호버 시에만 오버레이로 떠오름. 영속.
   */
  sidebarCollapsed: boolean;
}

export interface IndexProgress {
  current: number;
  total: number;
  current_file: string;
}

// ---------- Defaults ----------

/**
 * Workspace persistence schema. Bump on **breaking** field semantic changes
 * — additive fields don't need a bump because `loadFromStorage` already
 * merges with `DEFAULT_STATE`.
 *
 * History:
 *  - 1 — original (W1..W2). Default tab: "overview".
 *  - 2 — W3-PR4. Default tab promoted to "today" unless the user has
 *        explicitly switched tabs at least once (`defaultTabUserOverride`).
 *  - 3 — PR-UI 7. Code Workbench shell removed; the five legacy keys
 *        (codeSubTab / bottomDrawerTab / layoutMode / splitRatio /
 *        sidePanelOpen) are dropped (deletion-only, one-way — §04 §3/§6).
 */
export const WORKSPACE_SCHEMA_VERSION = 3;

const DEFAULT_STATE: WorkspaceState = {
  currentProjectId: null,
  currentProjectName: null,
  currentProjectRoot: null,
  // W3-PR4: Today is the default landing tab.
  activeView: "today",
  openFiles: [],
  activeFile: null,
  aiWorkbenchMode: "quick-edit",
  aiOverlayOpen: false,
  fileExplorerExpanded: {},
  recentChanges: [],
  sidePanelWidth: 260,
  sidePanelMode: "files",
  schemaVersion: WORKSPACE_SCHEMA_VERSION,
  defaultTabUserOverride: false,
  indexingProjectId: null,
  indexProgress: null,
  diffTarget: null,
  oculpmEnabled: false,
  oculpmStatus: null,
  currentSession: null,
  workdayKey: null,

  // Final UI Update (ui_v2) read-compat defaults (PR-UI 0).
  uiV2View: "today",
  journalFilter: "all",
  diffActivePath: null,
  diffReadPaths: [],
  diffMode: "unified",
  plannerOpen: {},
  plannerPlanId: null,
  searchScope: "semantic",
  searchRecent: [],
  terminalTabs: [],
  terminalActiveId: null,
  aiActiveModel: null,
  aiThreadId: null,
  docsActivePath: null,
  sidebarCollapsed: false,
};

const STORAGE_KEY = "aipm:workspace:v1";

/**
 * Lite-W6 PR8 Part 1: cap on `recentChanges` so a runaway watcher (or a
 * long-running dogfood session) can't grow the persisted blob unbounded.
 * 1000 entries × ~80 bytes each ≈ 80 KB on disk — well below the 5 MB
 * localStorage budget but enough to cover a busy day.
 */
export const RECENT_CHANGES_CAP = 1000;

/**
 * Append a change to the FIFO buffer. If the same path already has an entry
 * we drop the earlier one so the latest op wins (e.g. create→update collapses
 * to update). Trims to `RECENT_CHANGES_CAP` from the *front* so the newest
 * 1000 are kept. Exported for unit testing.
 */
export function pushRecentChange(
  prev: RecentChange[],
  next: RecentChange,
): RecentChange[] {
  const filtered = prev.filter((c) => c.path !== next.path);
  filtered.push(next);
  if (filtered.length > RECENT_CHANGES_CAP) {
    return filtered.slice(filtered.length - RECENT_CHANGES_CAP);
  }
  return filtered;
}

/**
 * Lite-W6 PR9: the AI overlay was migrated from `aiWorkbenchOpen`. We
 * intentionally drop the legacy true so the overlay never auto-opens on
 * launch — discovery happens through ⌘\, not surprise.
 */
export function migrateAiOverlayOpen(rawOverlay: unknown): boolean {
  return rawOverlay === true;
}

/**
 * Lite-W6 PR8 Part 2: clamp the persisted side-panel width into a usable
 * range so a corrupted value can't render the panel invisibly thin or push
 * the main pane off-screen. Defaults to the same value as `DEFAULT_STATE`.
 */
export const SIDE_PANEL_MIN_WIDTH = 200;
export const SIDE_PANEL_MAX_WIDTH = 500;
/**
 * Lite-W6 PR6.5: Diff mode lets the panel grow wider so the LocalDiffView
 * can switch to side-by-side at ≥1024px. We persist a single
 * `sidePanelWidth`, but the SidePanel render and resize handle apply this
 * higher cap when `sidePanelMode === "diff"`.
 */
export const SIDE_PANEL_MAX_WIDTH_DIFF = 1100;
export const SIDE_PANEL_DEFAULT_WIDTH = 260;

export function effectiveSidePanelMaxWidth(mode: SidePanelMode): number {
  return mode === "diff" ? SIDE_PANEL_MAX_WIDTH_DIFF : SIDE_PANEL_MAX_WIDTH;
}

export function migrateSidePanelWidth(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : SIDE_PANEL_DEFAULT_WIDTH;
  // Clamp to the absolute upper bound (diff mode); per-mode clamping happens
  // at render time so a value persisted from diff mode survives a trip
  // through files mode without being silently truncated.
  return Math.min(SIDE_PANEL_MAX_WIDTH_DIFF, Math.max(SIDE_PANEL_MIN_WIDTH, Math.round(n)));
}

/**
 * Lite-W6 PR6.3: fall back any non-member value to the default surface
 * (Files) so a corrupted persisted record doesn't blank the side panel.
 * Exported for unit testing.
 */
export function migrateSidePanelMode(raw: unknown): SidePanelMode {
  return raw === "diff" ? "diff" : "files";
}

/**
 * Project the watcher's 5-way op into the explorer's 3-way badge. `rename`
 * and `correct` both collapse to `M` for now — the FileTree doesn't have a
 * rename badge in 1.0. Exported for unit testing.
 */
export function mapFileOpToChangeOp(op: FileOp): ChangeOp {
  switch (op) {
    case "create":
      return "A";
    case "delete":
      return "D";
    case "update":
    case "rename":
    case "correct":
      return "M";
  }
}

// ---------- Legacy Migration ----------

/** Map legacy activeTab values to the current ActiveView union. */
function mapLegacyTab(tab: LegacyTab): ActiveView {
  switch (tab) {
    case "planner":
      return "plan";
    // The old Code sub-tabs (files/chat/assist/graph/terminal/git) all lived
    // under the "code" view (PR-UI 7 retired the sub-tab system).
    case "files":
    case "chat":
    case "assist":
    case "graph":
    case "terminal":
    case "git":
      return "code";
    // overview / today / settings / diagnostics → Today (default landing).
    default:
      return "today";
  }
}

/**
 * Migrate legacy localStorage keys (12 separate keys) → single WorkspaceState.
 * Preserves original keys during first migration, deletes them afterwards.
 */
function migrateV0(): WorkspaceState | null {
  const legacyKeys = [
    "selectedProjectId",
    "selectedProjectName",
    "selectedProjectRoot",
    "activeTab",
    "activeFile",
    "isTerminalPip",
  ];

  const hasLegacy = legacyKeys.some((k) => localStorage.getItem(k) !== null);
  if (!hasLegacy) return null;

  const projectId = localStorage.getItem("selectedProjectId");
  const projectName = localStorage.getItem("selectedProjectName");
  const projectRoot = localStorage.getItem("selectedProjectRoot");
  const activeTab = (localStorage.getItem("activeTab") as LegacyTab) || "overview";
  const activeFile = localStorage.getItem("activeFile");

  const migrated: WorkspaceState = {
    ...DEFAULT_STATE,
    currentProjectId: projectId ? Number(projectId) : null,
    currentProjectName: projectName,
    currentProjectRoot: projectRoot,
    activeView: mapLegacyTab(activeTab),
    activeFile,
  };

  // Clean up legacy keys
  legacyKeys.forEach((k) => localStorage.removeItem(k));
  // Also clean terminal PiP keys (feature removed per MASTER-GUIDE §5.6)
  ["terminalPipX", "terminalPipY", "terminalSessions", "terminalActiveSessionId"].forEach((k) =>
    localStorage.removeItem(k)
  );

  return migrated;
}

// ---------- Persistence ----------

/**
 * Schema v1 → v2 (W3-PR4). Promote `activeView: "overview"` → `"today"`
 * unless the user has explicitly chosen a tab (`defaultTabUserOverride`
 * field). Idempotent: re-running on a v2 record returns it unchanged.
 */
function migrateV1ToV2(state: WorkspaceState & { schemaVersion?: number; defaultTabUserOverride?: boolean }): WorkspaceState {
  if ((state.schemaVersion ?? 1) >= 2) return { ...state, schemaVersion: state.schemaVersion ?? 2 };
  const userOverride = state.defaultTabUserOverride === true;
  return {
    ...state,
    activeView: userOverride ? state.activeView : "today",
    defaultTabUserOverride: userOverride,
    schemaVersion: 2,
  };
}

/**
 * Lite-W6 PR7 Part 1: "overview" + "changelog" left the ActiveView
 * union. Anything that isn't a current member falls back to "today"
 * (the default landing tab). Exported for unit testing.
 */
export function migrateActiveView(raw: unknown): ActiveView {
  return raw === "today" || raw === "plan" || raw === "code" ? raw : "today";
}

/**
 * PR-UI 7 — schema v2 → v3. The Code Workbench shell is gone, so its five
 * persisted keys are dropped at parse time (see `loadFromStorage`); this
 * stamps the new schema version. One-way: there is no v3 → v2 reverse
 * (04-removal-and-migration §3, §6). Exported for unit testing.
 */
export function migrateV2ToV3(state: WorkspaceState): WorkspaceState {
  if (state.schemaVersion >= 3) return state;
  return { ...state, schemaVersion: 3 };
}

function loadFromStorage(): WorkspaceState {
  // Try new format first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      parsed.activeView = migrateActiveView(parsed.activeView);
      // PR-UI 7 (schema v3): the Code Workbench shell is gone — drop its five
      // persisted keys (deletion-only). bottomDrawerOpen is the even older
      // PR7-Part-2 legacy key that fed layoutMode.
      delete parsed.codeSubTab;
      delete parsed.layoutMode;
      delete parsed.splitRatio;
      delete parsed.sidePanelOpen;
      delete parsed.bottomDrawerOpen;
      delete parsed.bottomDrawerTab;
      // Lite-W6 PR8 Part 1: sanitise the persisted recentChanges buffer.
      // Anything that isn't a well-shaped {path, op, ts} entry is dropped so a
      // corrupted record can't crash the FileExplorer on next boot.
      if (Array.isArray(parsed.recentChanges)) {
        const safe: RecentChange[] = [];
        for (const raw of parsed.recentChanges) {
          if (
            raw &&
            typeof raw === "object" &&
            typeof raw.path === "string" &&
            (raw.op === "A" || raw.op === "M" || raw.op === "D") &&
            typeof raw.ts === "number"
          ) {
            // Lite-W6 PR6.5: read/unread flag. Legacy entries (pre-PR6.5)
            // are read as "read" so the user isn't ambushed by a buffer
            // full of "unread" markers after upgrade.
            const read = typeof raw.read === "boolean" ? raw.read : true;
            safe.push({ path: raw.path, op: raw.op, ts: raw.ts, read });
          }
        }
        parsed.recentChanges =
          safe.length > RECENT_CHANGES_CAP
            ? safe.slice(safe.length - RECENT_CHANGES_CAP)
            : safe;
      } else {
        parsed.recentChanges = [];
      }
      if (!parsed.fileExplorerExpanded || typeof parsed.fileExplorerExpanded !== "object") {
        parsed.fileExplorerExpanded = {};
      }
      // Lite-W6 PR6.3 + PR8 Part 2: side-panel width/mode persistence.
      // (sidePanelOpen was dropped above — PR-UI 7.)
      parsed.sidePanelWidth = migrateSidePanelWidth(parsed.sidePanelWidth);
      parsed.sidePanelMode = migrateSidePanelMode(parsed.sidePanelMode);
      // Lite-W6 PR9: aiWorkbenchOpen retired in favour of aiOverlayOpen.
      // Auto-opening the overlay on launch would be jarring; default to
      // closed regardless of the legacy persisted value.
      parsed.aiOverlayOpen = parsed.aiOverlayOpen === true;
      delete parsed.aiWorkbenchOpen;
      // Merge with defaults to handle new fields added in future versions
      const merged = {
        ...DEFAULT_STATE,
        ...parsed,
        // Always reset volatile state
        indexingProjectId: null,
        indexProgress: null,
        diffTarget: null,
        oculpmStatus: null,
        currentSession: null,
        workdayKey: null,
      };
      return migrateV2ToV3(migrateV1ToV2(merged));
    } catch {
      // Corrupted data, start fresh
    }
  }

  // Try legacy migration
  const migrated = migrateV0();
  if (migrated) {
    const upgraded = migrateV2ToV3(migrateV1ToV2(migrated));
    persistToStorage(upgraded);
    return upgraded;
  }

  return DEFAULT_STATE;
}

function persistToStorage(state: WorkspaceState) {
  // Only persist non-volatile fields
  const {
    indexingProjectId: _ip,
    indexProgress: _ipr,
    diffTarget: _dt,
    oculpmStatus: _os,
    currentSession: _cs,
    workdayKey: _wk,
    ...persistable
  } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
}

// ---------- Context ----------

interface WorkspaceContextValue {
  state: WorkspaceState;
  setState: React.Dispatch<React.SetStateAction<WorkspaceState>>;

  // Convenience actions
  setProject: (id: number | null, name?: string | null, root?: string | null) => void;
  setActiveView: (view: ActiveView) => void;
  /** Final UI Update (ui_v2) — set the active screen of the 8-view shell. */
  setUiV2View: (view: UiV2View) => void;
  setActiveFile: (file: string | null) => void;
  setIndexing: (projectId: number | null, progress?: IndexProgress | null) => void;
  resetWorkspace: () => void;

  // .oculpm/ helpers (W3-PR4). Listeners in WorkspaceProvider keep these in
  // sync; screens call them directly when they need to refresh on demand.
  setOculpmStatus: (status: OculpmStatus | null) => void;
  setCurrentSession: (session: Session | null) => void;
  setWorkdayKey: (workday: string | null) => void;

  // Lite-W6 PR6.3 / PR8 Part 2 — side panel width + surface switcher.
  // (sidePanelOpen / ⌘B toggle removed in PR-UI 7.)
  setSidePanelWidth: (width: number) => void;
  setSidePanelMode: (mode: SidePanelMode) => void;

  // Lite-W6 PR8 Part 3 — explicit clear for the change-highlight buffer.
  clearRecentChanges: () => void;
  /**
   * Lite-W6 PR6.5: flip one recentChanges entry's `read` flag to true. Used
   * by LocalDiffView when a diff body for that path is shown, so the file
   * list and FileExplorer can drop the "unread" emphasis.
   */
  markRecentChangeRead: (path: string) => void;

  // Lite-W6 PR9 — AI overlay (⌘\) + detach (⌘⇧\).
  toggleAiOverlay: () => void;
  setAiOverlayOpen: (open: boolean) => void;

  // Lite-W6 PR6.4 — one-shot FileTree → Diff handoff.
  openDiffFor: (path: string) => void;
  consumeDiffTarget: () => string | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(loadFromStorage);

  // Single useEffect for disk sync
  useEffect(() => {
    persistToStorage(state);
  }, [state]);

  const setProject = useCallback(
    (id: number | null, name?: string | null, root?: string | null) => {
      setState((prev) => {
        const switched = id !== prev.currentProjectId;
        return {
          ...prev,
          currentProjectId: id,
          currentProjectName: name ?? null,
          currentProjectRoot: root ?? null,
          activeFile: switched ? null : prev.activeFile,
          // Lite-W6 PR8 Part 1: changes from project A would be meaningless
          // (and confusing) when viewing project B's tree.
          recentChanges: switched ? [] : prev.recentChanges,
          fileExplorerExpanded: switched ? {} : prev.fileExplorerExpanded,
        };
      });
    },
    []
  );

  const setActiveView = useCallback((view: ActiveView) => {
    setState((prev) => ({
      ...prev,
      activeView: view,
      // First user pick locks in their preference — the v1→v2 migration
      // (and any future default-tab change) will respect this flag.
      defaultTabUserOverride: true,
    }));
  }, []);

  const setUiV2View = useCallback((view: UiV2View) => {
    setState((prev) => (prev.uiV2View === view ? prev : { ...prev, uiV2View: view }));
  }, []);

  const setActiveFile = useCallback((file: string | null) => {
    setState((prev) => ({ ...prev, activeFile: file }));
  }, []);

  const setIndexing = useCallback(
    (projectId: number | null, progress?: IndexProgress | null) => {
      setState((prev) => ({
        ...prev,
        indexingProjectId: projectId,
        indexProgress: progress ?? null,
      }));
    },
    []
  );

  const resetWorkspace = useCallback(() => {
    setState((prev) => ({
      ...DEFAULT_STATE,
      // Preserve non-project settings
      aiWorkbenchMode: prev.aiWorkbenchMode,
      // Carry forward the override flag — switching projects shouldn't
      // re-trigger the "default tab" demotion next launch.
      defaultTabUserOverride: prev.defaultTabUserOverride,
    }));
  }, []);

  // ── .oculpm/ helpers ────────────────────────────────────────────────────

  const setOculpmStatus = useCallback((status: OculpmStatus | null) => {
    setState((prev) => ({
      ...prev,
      oculpmStatus: status,
      oculpmEnabled: status?.initialized ?? false,
      workdayKey: status?.current_workday ?? prev.workdayKey,
    }));
  }, []);

  const setCurrentSession = useCallback((session: Session | null) => {
    setState((prev) => ({ ...prev, currentSession: session }));
  }, []);

  const setWorkdayKey = useCallback((workday: string | null) => {
    setState((prev) => ({ ...prev, workdayKey: workday }));
  }, []);

  const setSidePanelWidth = useCallback((width: number) => {
    setState((prev) => ({ ...prev, sidePanelWidth: migrateSidePanelWidth(width) }));
  }, []);

  const setSidePanelMode = useCallback((mode: SidePanelMode) => {
    setState((prev) => ({ ...prev, sidePanelMode: migrateSidePanelMode(mode) }));
  }, []);

  const clearRecentChanges = useCallback(() => {
    setState((prev) =>
      prev.recentChanges.length === 0 ? prev : { ...prev, recentChanges: [] },
    );
  }, []);

  /**
   * Lite-W6 PR6.5: flip a single change to read=true. Called by LocalDiffView
   * when the diff body for that path has been rendered (the user has "seen"
   * the change). No-op when the path isn't in the buffer or is already read,
   * so we don't churn setState on every body re-render.
   */
  const markRecentChangeRead = useCallback((path: string) => {
    setState((prev) => {
      const entry = prev.recentChanges.find((c) => c.path === path);
      if (!entry || entry.read) return prev;
      return {
        ...prev,
        recentChanges: prev.recentChanges.map((c) =>
          c.path === path ? { ...c, read: true } : c,
        ),
      };
    });
  }, []);

  const toggleAiOverlay = useCallback(() => {
    setState((prev) => ({ ...prev, aiOverlayOpen: !prev.aiOverlayOpen }));
  }, []);

  const setAiOverlayOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, aiOverlayOpen: open }));
  }, []);

  /**
   * Lite-W6 PR6.4: invoked by the FileExplorer when a user clicks a file
   * that has a recentChanges entry. Atomically jumps the side panel to Diff
   * mode, ensures the panel is open, and stashes the target path so
   * LocalDiffView can pre-select it. The clear half lives in `consumeDiffTarget`.
   */
  const openDiffFor = useCallback((path: string) => {
    setState((prev) => ({
      ...prev,
      sidePanelMode: "diff",
      diffTarget: path,
    }));
  }, []);

  /**
   * Lite-W6 PR6.4: LocalDiffView calls this on mount + after each effect
   * that observes diffTarget; it returns the pending target and clears it
   * in the same setState so we don't snap back to it on every selection
   * change. Single-shot semantics.
   */
  const consumeDiffTarget = useCallback((): string | null => {
    const current = stateRef.current?.diffTarget ?? null;
    if (current !== null) {
      setState((prev) =>
        prev.diffTarget === null ? prev : { ...prev, diffTarget: null },
      );
    }
    return current;
  }, []);

  // ── Tauri event listeners ───────────────────────────────────────────────
  // Mount once. Each handler filters by `project_id === currentProjectId`
  // so multi-project setups (future) won't cross-contaminate.
  useEffect(() => {
    const currentProjectId = () => stateRef.current?.currentProjectId ?? null;
    const offFns: Array<() => void> = [];

    void events.oculpmSessionStarted.listen((evt) => {
      if (evt.payload.project_id === currentProjectId()) {
        setCurrentSession(evt.payload.session);
      }
    }).then((off) => offFns.push(off));

    void events.oculpmSessionEnded.listen((evt) => {
      if (evt.payload.project_id === currentProjectId()) {
        // Surface the just-ended session for one render so consumers can
        // animate it out, then clear.
        setCurrentSession(null);
      }
    }).then((off) => offFns.push(off));

    void events.oculpmIntegrityWarning.listen((evt) => {
      if (evt.payload.project_id !== currentProjectId()) return;
      const w = evt.payload.warning;
      // W4-PR8: surface as warning toast. Dedup per (kind, path) within 30s so
      // a single bad file doesn't spam repeated re-saves.
      toast.warning(w.message, {
        title: `[${w.kind}] ${w.path}`,
        dedupKey: `integrity:${w.kind}:${w.path}`,
      });
      console.warn("[oculpm] integrity warning:", w);
    }).then((off) => offFns.push(off));

    void events.oculpmAgentDrift.listen((evt) => {
      const pid = currentProjectId();
      if (evt.payload.project_id !== pid || pid == null) return;
      const { agent_id: agentId } = evt.payload;
      if (DriftCooldown.isDismissed(agentId)) return;
      toast.warning(
        `${agentId} 규칙 파일이 외부에서 수정되었습니다.`,
        {
          title: "어댑터 drift 감지",
          dedupKey: `drift:${agentId}`,
          dedupWindowMs: 60_000,
          durationMs: 0, // sticky until user acts
          actions: [
            {
              label: "동기화",
              onClick: () => {
                if (pid == null) return;
                oculpmApi
                  .syncAgents(pid)
                  .then((report) => {
                    const updated = report.results.filter(
                      (r) => r.action === "inserted" || r.action === "updated",
                    ).length;
                    DriftCooldown.clear(agentId);
                    toast.info(`동기화 완료 (${updated} 어댑터 갱신)`);
                  })
                  .catch((e) => {
                    const msg = e instanceof OculpmApiError ? e.message : String(e);
                    toast.destructive(`동기화 실패: ${msg}`);
                  });
              },
            },
            {
              label: "무시 (5분)",
              onClick: () => DriftCooldown.dismiss(agentId),
            },
          ],
        },
      );
    }).then((off) => offFns.push(off));

    // The watcher emits these on every journal file write — TodayScreen
    // listens directly for invalidation (the context only forwards them
    // so multiple screens can subscribe through the same channel).
    void events.oculpmJournalPathChanged.listen(() => {}).then((off) => offFns.push(off));

    // Lite-W6 PR8 Part 1: feed the FileTree's change-highlight buffer.
    void events.oculpmFileChanged.listen((evt) => {
      if (evt.payload.project_id !== currentProjectId()) return;
      const op = mapFileOpToChangeOp(evt.payload.event.op);
      const path = evt.payload.event.path;
      // Dogfooding (2026-06-07) — forbidden-path matches arrive pre-masked as
      // `**redacted/sensitive**:<hash>`. They can't be opened (computeDiff has
      // no real path) and are pure noise in the 변경 diff list, so drop them
      // here. The ndjson/journal masking on the backend is untouched.
      if (path.startsWith("**redacted/sensitive**")) return;
      setState((prev) => ({
        ...prev,
        recentChanges: pushRecentChange(prev.recentChanges, {
          path,
          op,
          ts: Date.now(),
          // Lite-W6 PR6.5: every fresh watcher event starts unread so the
          // LocalDiffView can surface "new since you last looked".
          read: false,
        }),
      }));
    }).then((off) => offFns.push(off));

    void events.oculpmJournalAdded.listen((evt) => {
      if (evt.payload.project_id !== currentProjectId()) return;
      toast.info(`새 기록: ${evt.payload.summary.title}`, {
        dedupKey: `journal_added:${evt.payload.summary.relative_path}`,
      });
    }).then((off) => offFns.push(off));
    void events.oculpmJournalUpdated.listen(() => {}).then((off) => offFns.push(off));

    return () => {
      offFns.forEach((off) => off());
    };
  }, [setCurrentSession]);

  // Keep a ref to the latest state so the listener effect above doesn't
  // need to re-subscribe on every project switch.
  const stateRef = React.useRef<WorkspaceState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  return (
    <WorkspaceContext.Provider
      value={{
        state,
        setState,
        setProject,
        setActiveView,
        setUiV2View,
        setActiveFile,
        setIndexing,
        resetWorkspace,
        setOculpmStatus,
        setCurrentSession,
        setWorkdayKey,
        setSidePanelWidth,
        setSidePanelMode,
        clearRecentChanges,
        markRecentChangeRead,
        toggleAiOverlay,
        setAiOverlayOpen,
        openDiffFor,
        consumeDiffTarget,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}
