/**
 * WorkspaceContext — 앱 전역 상태의 단일 컨텍스트 (MASTER-GUIDE §6.1)
 *
 * 원칙:
 * - localStorage 접근은 이 파일 안에서만 (eslint rule로 강제)
 * - 영속화 키: "aipm:workspace:v1" 단일 키 + JSON
 * - 마이그레이션 함수로 기존 12개 키 자동 흡수 후 삭제
 */
import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

import { events, type OculpmStatus, type Session } from "@/lib/bindings";

// ---------- State Shape ----------

export type ActiveView = "overview" | "today" | "plan" | "changelog" | "code";
export type AiWorkbenchMode = "quick-edit" | "chat";
export type BottomDrawerTab = "terminal" | "git" | "problems";

/**
 * Transitional secondary tab inside the "code" view. UI-5 (W5) will absorb
 * these into the unified Code workbench (editor + AI workbench + bottom
 * drawer). Until then we keep them as named sub-tabs so the IA-5 sidebar
 * change can ship without that bigger refactor.
 */
export type CodeSubTab = "files" | "ai" | "graph" | "terminal" | "git";

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
  aiWorkbenchOpen: boolean;
  bottomDrawerOpen: boolean;
  bottomDrawerTab: BottomDrawerTab;

  // File explorer expanded state
  fileExplorerExpanded: Record<string, boolean>;

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
  aiWorkbenchOpen: true,
  bottomDrawerOpen: false,
  bottomDrawerTab: "terminal",
  fileExplorerExpanded: {},
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

// ---------- Legacy Migration ----------

/** Map legacy activeTab values to the new (activeView, codeSubTab) pair. */
function mapLegacyTab(tab: LegacyTab): { view: ActiveView; sub: CodeSubTab } {
  switch (tab) {
    case "overview": return { view: "overview", sub: "files" };
    case "today":    return { view: "today",    sub: "files" };
    case "planner":  return { view: "plan",     sub: "files" };
    case "files":    return { view: "code",     sub: "files" };
    case "chat":     return { view: "code",     sub: "ai" };
    case "assist":   return { view: "code",     sub: "ai" };
    case "graph":    return { view: "code",     sub: "graph" };
    case "terminal": return { view: "code",     sub: "terminal" };
    case "git":      return { view: "code",     sub: "git" };
    // Settings/diagnostics are not view-level any more (⌘, opens a screen);
    // default landing for these legacy values is the Overview.
    case "settings":
    case "diagnostics":
      return { view: "overview", sub: "files" };
    default:
      return { view: "overview", sub: "files" };
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
      setState((prev) => ({
        ...prev,
        currentProjectId: id,
        currentProjectName: name ?? null,
        currentProjectRoot: root ?? null,
        activeFile: id !== prev.currentProjectId ? null : prev.activeFile,
      }));
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
      bottomDrawerTab: prev.bottomDrawerTab,
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
      if (evt.payload.project_id === currentProjectId()) {
        // W4 will route this to the toast layer; PR4 just logs.
        console.warn("[oculpm] integrity warning:", evt.payload.warning);
      }
    }).then((off) => offFns.push(off));

    // The watcher emits these on every journal file write — TodayScreen
    // listens directly for invalidation (the context only forwards them
    // so multiple screens can subscribe through the same channel).
    // Stored as a no-op here; PR6 wires the actual cache invalidation.
    void events.oculpmJournalPathChanged.listen(() => {}).then((off) => offFns.push(off));
    void events.oculpmJournalAdded.listen(() => {}).then((off) => offFns.push(off));
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
