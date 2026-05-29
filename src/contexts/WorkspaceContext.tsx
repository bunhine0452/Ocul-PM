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
 * Lite-W6 PR7 Part 2 introduces a Workspace-level layout mode. The Terminal
 * is no longer trapped inside Code's BottomDrawer — it docks at the bottom
 * of the workspace for every view and the mode controls how much of the
 * vertical real estate it claims.
 *
 *  - "main-only"      : 100% activeView, terminal hidden (still mounted to
 *                       preserve PTY sessions; CSS-hidden).
 *  - "split"          : activeView on top, Terminal on bottom. Ratio
 *                       persisted in `splitRatio` (activeView portion).
 *  - "terminal-only"  : full-height Terminal; activeView hidden.
 */
export type LayoutMode = "main-only" | "split" | "terminal-only";

/**
 * Transitional secondary tab inside the "code" view. PR5 retired the "git"
 * sub-tab along with GitPanel.
 */
export type CodeSubTab = "files" | "ai" | "graph" | "terminal";

/**
 * Lite-W6 PR8 Part 1: FileTree change-highlight marker. The watcher's
 * `FileOp` collapses into three categories the explorer renders as dot +
 * badge. See `mapFileOpToChangeOp` for the projection.
 */
export type ChangeOp = "A" | "M" | "D";

export type SidePanelMode = "files" | "diff";

export interface RecentChange {
  /** Project-relative forward-slash path (matches `ProjectTreeNode.relative_path`). */
  path: string;
  op: ChangeOp;
  /** Unix milliseconds when we ingested the event. Used only for ordering. */
  ts: number;
}

// Legacy tab names for migration
type LegacyTab = "files" | "chat" | "assist" | "graph" | "planner" | "settings" | "diagnostics" | "terminal" | "git" | "overview" | "today";

export interface WorkspaceState {
  // Project
  currentProjectId: number | null;
  currentProjectName: string | null;
  currentProjectRoot: string | null;

  // PM-narrative IA (5 top-level views)
  activeView: ActiveView;
  /** Sub-tab inside the "code" view (W5 will absorb most of these) */
  codeSubTab: CodeSubTab;

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

  // Workspace-level dock layout (Lite-W6 PR7 Part 2)
  layoutMode: LayoutMode;
  /** Portion (0.1..0.9) of the vertical space the activeView gets in
   *  "split" mode. Ignored for main-only / terminal-only. */
  splitRatio: number;

  // File explorer expanded state
  fileExplorerExpanded: Record<string, boolean>;

  /**
   * Lite-W6 PR8 Part 1: FIFO buffer of watcher-observed changes for the
   * current project. Capped at `RECENT_CHANGES_CAP` (1000) to bound memory
   * growth during long sessions. Cleared on project switch.
   */
  recentChanges: RecentChange[];

  /**
   * Lite-W6 PR8 Part 2: Workspace-level left side panel (FileTree, and later
   * LocalDiffView). Toggled with ⌘B. Width is persisted independently so the
   * user's resize survives session restarts.
   */
  sidePanelOpen: boolean;
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

  // .oculpm/ — populated by event listeners + on-demand fetches (W3-PR4).
  // Volatile: re-derived on project switch.
  oculpmEnabled: boolean;
  oculpmStatus: OculpmStatus | null;
  currentSession: Session | null;
  /** `YYYYMMDD` per project workday tz. Updated on `workday_boundary`. */
  workdayKey: string | null;
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
 */
export const WORKSPACE_SCHEMA_VERSION = 2;

const DEFAULT_STATE: WorkspaceState = {
  currentProjectId: null,
  currentProjectName: null,
  currentProjectRoot: null,
  // W3-PR4: Today is the default landing tab.
  activeView: "today",
  codeSubTab: "files",
  openFiles: [],
  activeFile: null,
  aiWorkbenchMode: "quick-edit",
  aiOverlayOpen: false,
  layoutMode: "main-only",
  splitRatio: 0.6,
  fileExplorerExpanded: {},
  recentChanges: [],
  sidePanelOpen: false,
  sidePanelWidth: 260,
  sidePanelMode: "files",
  schemaVersion: WORKSPACE_SCHEMA_VERSION,
  defaultTabUserOverride: false,
  indexingProjectId: null,
  indexProgress: null,
  oculpmEnabled: false,
  oculpmStatus: null,
  currentSession: null,
  workdayKey: null,
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
export const SIDE_PANEL_DEFAULT_WIDTH = 260;

export function migrateSidePanelWidth(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : SIDE_PANEL_DEFAULT_WIDTH;
  return Math.min(SIDE_PANEL_MAX_WIDTH, Math.max(SIDE_PANEL_MIN_WIDTH, Math.round(n)));
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

/** Map legacy activeTab values to the new (activeView, codeSubTab) pair. */
function mapLegacyTab(tab: LegacyTab): { view: ActiveView; sub: CodeSubTab } {
  switch (tab) {
    // Lite-W6 PR7 Part 1: "overview" left the ActiveView union; legacy
    // values land on Today (Overview's widgets become Today's cards in
    // PR8/PR9 per 04-ui-ux §2).
    case "overview": return { view: "today", sub: "files" };
    case "today":    return { view: "today", sub: "files" };
    case "planner":  return { view: "plan",  sub: "files" };
    case "files":    return { view: "code",  sub: "files" };
    case "chat":     return { view: "code",  sub: "ai" };
    case "assist":   return { view: "code",  sub: "ai" };
    case "graph":    return { view: "code",  sub: "graph" };
    case "terminal": return { view: "code",  sub: "terminal" };
    // Lite-W6 PR5: "git" CodeSubTab was removed; legacy values land on files.
    case "git":      return { view: "code",  sub: "files" };
    // Settings/diagnostics are not view-level any more (⌘, opens a screen);
    // default landing for these legacy values is Today.
    case "settings":
    case "diagnostics":
      return { view: "today", sub: "files" };
    default:
      return { view: "today", sub: "files" };
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

  const mapped = mapLegacyTab(activeTab);
  const migrated: WorkspaceState = {
    ...DEFAULT_STATE,
    currentProjectId: projectId ? Number(projectId) : null,
    currentProjectName: projectName,
    currentProjectRoot: projectRoot,
    activeView: mapped.view,
    codeSubTab: mapped.sub,
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
 * Lite-W6 PR7 Part 2: the workspace layout is now controlled by a
 * tri-state mode instead of the old `bottomDrawerOpen` boolean. The
 * legacy field maps as `true → "split"`, `false → "main-only"`.
 * Anything else (including missing values) lands on "main-only".
 * Exported so the migration is unit-testable.
 */
export function migrateLayoutMode(
  rawLayoutMode: unknown,
  rawLegacyBottomDrawerOpen: unknown,
): LayoutMode {
  if (
    rawLayoutMode === "main-only" ||
    rawLayoutMode === "split" ||
    rawLayoutMode === "terminal-only"
  ) {
    return rawLayoutMode;
  }
  if (rawLegacyBottomDrawerOpen === true) return "split";
  return "main-only";
}

/**
 * Lite-W6 PR7 Part 2: clamp `splitRatio` to a usable range so a
 * corrupted persisted value can't render the activeView or terminal
 * pane invisibly thin. The default mirrors `DEFAULT_STATE.splitRatio`.
 */
export function migrateSplitRatio(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0.6;
  return Math.min(0.9, Math.max(0.1, n));
}

function loadFromStorage(): WorkspaceState {
  // Try new format first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      // Migrate legacy codeSubTab values ("chat" | "assist" → "ai")
      if (parsed.codeSubTab === "chat" || parsed.codeSubTab === "assist") {
        parsed.codeSubTab = "ai";
      }
      // Lite-W6 PR5: the "git" CodeSubTab was removed along with GitPanel.
      if (parsed.codeSubTab === "git") {
        parsed.codeSubTab = "files";
      }
      parsed.activeView = migrateActiveView(parsed.activeView);
      // Lite-W6 PR7 Part 2 retired bottomDrawerOpen / bottomDrawerTab in
      // favour of layoutMode + splitRatio.
      parsed.layoutMode = migrateLayoutMode(
        parsed.layoutMode,
        parsed.bottomDrawerOpen,
      );
      parsed.splitRatio = migrateSplitRatio(parsed.splitRatio);
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
            safe.push({ path: raw.path, op: raw.op, ts: raw.ts });
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
      // Lite-W6 PR8 Part 2 + PR6.3: side-panel persistence.
      parsed.sidePanelOpen = parsed.sidePanelOpen === true;
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
        oculpmStatus: null,
        currentSession: null,
        workdayKey: null,
      };
      return migrateV1ToV2(merged);
    } catch {
      // Corrupted data, start fresh
    }
  }

  // Try legacy migration
  const migrated = migrateV0();
  if (migrated) {
    const upgraded = migrateV1ToV2(migrated);
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
  setCodeSubTab: (sub: CodeSubTab) => void;
  /** Jump directly to a code-view sub-tab (also sets activeView="code"). */
  openInCode: (sub: CodeSubTab) => void;
  setActiveFile: (file: string | null) => void;
  setIndexing: (projectId: number | null, progress?: IndexProgress | null) => void;
  resetWorkspace: () => void;

  // .oculpm/ helpers (W3-PR4). Listeners in WorkspaceProvider keep these in
  // sync; screens call them directly when they need to refresh on demand.
  setOculpmStatus: (status: OculpmStatus | null) => void;
  setCurrentSession: (session: Session | null) => void;
  setWorkdayKey: (workday: string | null) => void;

  // Lite-W6 PR8 Part 2 — left side panel (⌘B).
  toggleSidePanel: () => void;
  setSidePanelOpen: (open: boolean) => void;
  setSidePanelWidth: (width: number) => void;
  // Lite-W6 PR6.3 — side panel surface switcher.
  setSidePanelMode: (mode: SidePanelMode) => void;

  // Lite-W6 PR8 Part 3 — explicit clear for the change-highlight buffer.
  clearRecentChanges: () => void;

  // Lite-W6 PR9 — AI overlay (⌘\) + detach (⌘⇧\).
  toggleAiOverlay: () => void;
  setAiOverlayOpen: (open: boolean) => void;
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

  const setCodeSubTab = useCallback((sub: CodeSubTab) => {
    setState((prev) => ({ ...prev, codeSubTab: sub }));
  }, []);

  const openInCode = useCallback((sub: CodeSubTab) => {
    setState((prev) => ({ ...prev, activeView: "code", codeSubTab: sub }));
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
      layoutMode: prev.layoutMode,
      splitRatio: prev.splitRatio,
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

  const toggleSidePanel = useCallback(() => {
    setState((prev) => ({ ...prev, sidePanelOpen: !prev.sidePanelOpen }));
  }, []);

  const setSidePanelOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, sidePanelOpen: open }));
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

  const toggleAiOverlay = useCallback(() => {
    setState((prev) => ({ ...prev, aiOverlayOpen: !prev.aiOverlayOpen }));
  }, []);

  const setAiOverlayOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, aiOverlayOpen: open }));
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
      setState((prev) => ({
        ...prev,
        recentChanges: pushRecentChange(prev.recentChanges, {
          path,
          op,
          ts: Date.now(),
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
        setCodeSubTab,
        openInCode,
        setActiveFile,
        setIndexing,
        resetWorkspace,
        setOculpmStatus,
        setCurrentSession,
        setWorkdayKey,
        toggleSidePanel,
        setSidePanelOpen,
        setSidePanelWidth,
        setSidePanelMode,
        clearRecentChanges,
        toggleAiOverlay,
        setAiOverlayOpen,
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
