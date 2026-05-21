/**
 * WorkspaceContext — 앱 전역 상태의 단일 컨텍스트 (MASTER-GUIDE §6.1)
 *
 * 원칙:
 * - localStorage 접근은 이 파일 안에서만 (eslint rule로 강제)
 * - 영속화 키: "aipm:workspace:v1" 단일 키 + JSON
 * - 마이그레이션 함수로 기존 12개 키 자동 흡수 후 삭제
 */
import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

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
export type CodeSubTab = "files" | "chat" | "assist" | "graph" | "terminal" | "git";

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

  // Volatile (not persisted)
  indexingProjectId: number | null;
  indexProgress: IndexProgress | null;
}

export interface IndexProgress {
  current: number;
  total: number;
  current_file: string;
}

// ---------- Defaults ----------

const DEFAULT_STATE: WorkspaceState = {
  currentProjectId: null,
  currentProjectName: null,
  currentProjectRoot: null,
  activeView: "overview",
  codeSubTab: "files",
  openFiles: [],
  activeFile: null,
  aiWorkbenchMode: "quick-edit",
  aiWorkbenchOpen: true,
  bottomDrawerOpen: false,
  bottomDrawerTab: "terminal",
  fileExplorerExpanded: {},
  indexingProjectId: null,
  indexProgress: null,
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
    case "chat":     return { view: "code",     sub: "chat" };
    case "assist":   return { view: "code",     sub: "assist" };
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

function loadFromStorage(): WorkspaceState {
  // Try new format first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new fields added in future versions
      return {
        ...DEFAULT_STATE,
        ...parsed,
        // Always reset volatile state
        indexingProjectId: null,
        indexProgress: null,
      };
    } catch {
      // Corrupted data, start fresh
    }
  }

  // Try legacy migration
  const migrated = migrateV0();
  if (migrated) {
    persistToStorage(migrated);
    return migrated;
  }

  return DEFAULT_STATE;
}

function persistToStorage(state: WorkspaceState) {
  // Only persist non-volatile fields
  const { indexingProjectId: _, indexProgress: __, ...persistable } = state;
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
    setState((prev) => ({ ...prev, activeView: view }));
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
    }));
  }, []);

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
