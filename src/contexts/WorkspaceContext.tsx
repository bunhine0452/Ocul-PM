/**
 * WorkspaceContext — 앱 전역 상태의 단일 컨텍스트 (MASTER-GUIDE §6.1)
 *
 * 원칙:
 * - localStorage 접근은 이 파일 안에서만 (eslint rule로 강제)
 * - 영속화 키: **프로젝트별** "aipm:workspace:v2:p<id>" + JSON
 * - 마이그레이션 함수로 기존 12개 키 / 단일 v1 키를 자동 흡수 후 삭제
 *
 * 멀티 창 (v2.9.0): 창 하나 = 프로젝트 하나 (I1/I3). 창의 프로젝트는 URL 이
 * 정하고 런타임에 바뀌지 않으므로 `currentProjectId` 는 프로바이더 prop 에서
 * 오며 **영속 대상이 아니다** — 저장했다가 다시 읽으면 URL 과 어긋날 수 있는
 * 중복 진실이다. 키를 프로젝트별로 쪼갠 이유는 창 두 개가 같은 origin 의
 * localStorage 를 공유하기 때문이다 (단일 키였을 때는 300ms 디바운스 저장이
 * 서로를 덮어써서 창 B 의 터미널 탭이 창 A 의 탭을 지웠다).
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { safeUnlisten } from "@/lib/unlisten";

import { events, type FileOp, type OculpmStatus, type Session } from "@/lib/bindings";
import type { PlanGroup, PlanSort } from "@/features/planner/planList";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { toast, DriftCooldown } from "@/lib/toast";
import { recentChangesStore, type ChangeOp } from "@/lib/recentChangesStore";
// 이벤트 리스너 안에서 부르는 토스트라 훅이 아닌 모듈 t() 가 맞다
// (구독 시점이 아니라 **발생 시점**의 언어를 읽어야 한다).
import { t } from "@/i18n";

// v2 U3 — recentChanges 는 전용 외부 스토어로 분리됐다 (아래 주석 및
// docs/20260706_v2/03-performance-spec.md §1). 기존 임포트 경로 호환을 위해
// 타입/헬퍼를 재수출한다.
export { pushRecentChange, RECENT_CHANGES_CAP, recentChangesStore, useRecentChanges } from "@/lib/recentChangesStore";
export type { RecentChange, ChangeOp } from "@/lib/recentChangesStore";

// ---------- State Shape ----------

/**
 * Lite-W6 PR7 (Part 1) narrows the IA: "overview" (absorbed into Today
 * per 04-ui-ux §2) and "changelog" (PR4 retired the route) both leave
 * the union. "code" stays accessible until PR8/PR9 absorb its FileTree
 * and AI parts. Persisted values for the removed routes fall back to
 * "today" inside `loadFromStorage` + `mapLegacyTab`.
 */
export type ActiveView = "today" | "plan" | "code";

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
  | "discussion"
  | "retro"
  | "search"
  | "terminal"
  | "ai"
  | "graph"
  | "docs"
  | "skills"
  // PR-ACP6 — Claude Code 구동면. "ai"(프로바이더 채팅)와 성격이 달라 화면을
  // 나눴다: 저쪽은 물어보는 곳, 이쪽은 시키는 곳이다.
  | "claudecode"
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
  /** 분할 페인 레이아웃 (2026-07-20 터미널 개편). 없으면 leaf(id) 단일 페인. */
  panes?: TerminalPaneNode;
  /** 포커스된 페인 sid (분할 시). 없거나 무효면 첫 leaf. */
  focusSid?: string;
}
/** 터미널 분할 트리 — 실제 정의는 `@/lib/termPanes` (여기선 영속 타입만 재수출). */
export type TerminalPaneNode = import("@/lib/termPanes").PaneNode;

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
  // (aiWorkbenchMode / aiOverlayOpen 은 감사 2026-07-16 에서 은퇴 — ⌘\ 오버레이
  // 채팅 스택이 AI 패널 화면으로 단일화되면서 상태도 함께 제거. 과거 영속
  // 레코드의 두 키는 loadFromStorage 에서 일방향 삭제된다.)

  // File explorer expanded state
  fileExplorerExpanded: Record<string, boolean>;

  // v2 U3: recentChanges 는 더 이상 여기 없다 — 파일 이벤트마다 전 소비자가
  // 리렌더되는 것을 막기 위해 `@/lib/recentChangesStore` 로 분리 (구독형).

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
   * If true the user had explicitly chosen a tab via the (now-removed) IA
   * strip — we leave their choice alone during the v1→v2 migration. Retained
   * as a read-compat field: only persisted records (pre-ui_v2) set it; the
   * migration normalizer still honours it.
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
  /**
   * Planner 계획 레일의 정렬·묶기·접힘 (2026-07-30 스케일 라운드).
   *
   * 예전 칩 행의 완료/보관 펼침 상태는 컴포넌트 로컬이라 ⌘K 점프의 강제
   * remount 마다 초기화됐다 — 계획이 많을수록 '정리해 둔 것이 안 남는' 체감의
   * 절반이 이것이었다. 레일 설정은 영속화한다.
   *
   * 검색어는 일부러 영속화하지 않는다: 다음 진입 때 계획이 숨어 보인다.
   */
  plannerSort: PlanSort;
  plannerGroup: PlanGroup;
  /**
   * 사용자가 명시적으로 여닫은 레일 섹션 (key → 펼침). 여기 없는 섹션은
   * 섹션 자신의 기본값을 따른다 — 완료·보관은 기본 접힘, 진행 중은 펼침.
   * key 어휘가 유한("done"/"archived"/"today"/"agent:<id>"…)해서 무한히
   * 자라지 않는다.
   */
  plannerRailOpen: Record<string, boolean>;
  /** 레일 자체를 접어 문서 폭을 되찾은 상태 (계획이 적을 때 유용). */
  plannerRailCollapsed: boolean;
  /** 코드 검색 scope. */
  searchScope: SearchScope;
  /** 최근 검색어 (최대 10개). */
  searchRecent: string[];
  /** 터미널 탭 목록 (PTY 핸들은 휘발성 — 여기엔 메타만). */
  terminalTabs: TerminalTab[];
  /** 활성 터미널 탭 id. */
  terminalActiveId: string | null;
  /** 터미널 글자 크기 (⌘+/⌘- 로 조절, 2026-07-20). */
  terminalFontSize: number;
  /** 에이전트 화면 활성 모델 id. */
  aiActiveModel: string | null;
  /** Claude Code 화면의 왼쪽 대화 목록 패널이 열려 있는지 (PR-ACP7). */
  acpPanelOpen: boolean;
  /** AI 패널 + 오버레이가 공유하는 thread id. */
  aiThreadId: string | null;
  /** 문서(docs) 화면에서 마지막으로 본 문서의 프로젝트-루트 기준 경로 (예: docs/README.md). */
  docsActivePath: string | null;
  /** 문제 해결(Discussion) 화면에서 마지막으로 본 토의 문서의 id (frontmatter slug). */
  discussionActiveId: string | null;
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
 *  - 4 — 멀티 프로젝트 창 (v2.9.0). 단일 키가 프로젝트별 키로 쪼개졌고
 *        (`storageKeyFor`), currentProjectId/Name/Root 는 영속 대상에서
 *        빠졌다 (창 URL 이 단일 진실). 필드 추가가 아니라 키 분할이라 breaking.
 */
export const WORKSPACE_SCHEMA_VERSION = 4;

const DEFAULT_STATE: WorkspaceState = {
  currentProjectId: null,
  currentProjectName: null,
  currentProjectRoot: null,
  // W3-PR4: Today is the default landing tab.
  activeView: "today",
  openFiles: [],
  activeFile: null,
  fileExplorerExpanded: {},
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

  // Final UI Update (ui_v2) read-compat defaults (PR-UI 0).
  uiV2View: "today",
  journalFilter: "all",
  diffActivePath: null,
  diffReadPaths: [],
  diffMode: "unified",
  plannerOpen: {},
  plannerPlanId: null,
  plannerSort: "recent",
  plannerGroup: "status",
  plannerRailOpen: {},
  plannerRailCollapsed: false,
  searchScope: "semantic",
  searchRecent: [],
  terminalTabs: [],
  terminalActiveId: null,
  terminalFontSize: 13,
  aiActiveModel: null,
  acpPanelOpen: true,
  aiThreadId: null,
  docsActivePath: null,
  discussionActiveId: null,
  sidebarCollapsed: false,
};

/**
 * 창 하나 = 프로젝트 하나이므로 영속 키도 프로젝트별이다 (멀티 창 T3/R3).
 * 테스트가 키를 하드코딩하지 않도록 export 한다.
 */
export const storageKeyFor = (projectId: number) => `aipm:workspace:v2:p${projectId}`;

/** 단일 키 시절(schema ≤3)의 레코드. 1회 이관 후 삭제한다. */
const LEGACY_SINGLE_KEY = "aipm:workspace:v1";

/** v2 U3 — 상태 변경 폭주(타이핑·연속 토글) 시 저장을 병합하는 트레일링 디바운스. */
export const PERSIST_DEBOUNCE_MS = 300;


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

/**
 * schema v3 → v4 (멀티 프로젝트 창). 레코드가 프로젝트별 키 아래로 옮겨지고
 * `currentProjectId/Name/Root` 가 영속 대상에서 빠진 상태를 표시한다. 키 이동
 * 자체는 `migrateSingleKeyToPerProject` 가 하므로 여기서는 버전만 찍는다.
 * 일방향 — v4 → v3 역마이그레이션은 없다. Exported for unit testing.
 */
export function migrateV3ToV4(state: WorkspaceState): WorkspaceState {
  if (state.schemaVersion >= 4) return state;
  return { ...state, schemaVersion: 4 };
}

/**
 * schema v3 → v4 (멀티 창). 단일 키 레코드를 그 안에 적혀 있던
 * `currentProjectId` 의 프로젝트별 키로 1회 이관하고 원본을 지운다.
 * `currentProjectId` 가 `null` 이면 이관할 창이 없으므로(런처 상태였다) 버린다.
 * 멱등 — 원본 키가 없으면 아무 일도 하지 않는다. 반환값은 이관 대상 프로젝트
 * id (테스트용).
 */
export function migrateSingleKeyToPerProject(): number | null {
  const raw = localStorage.getItem(LEGACY_SINGLE_KEY);
  if (raw === null) return null;
  localStorage.removeItem(LEGACY_SINGLE_KEY);
  try {
    const parsed = JSON.parse(raw);
    const pid =
      typeof parsed?.currentProjectId === "number" ? parsed.currentProjectId : null;
    if (pid === null) return null;
    const key = storageKeyFor(pid);
    // 이미 그 프로젝트의 새 레코드가 있으면 그쪽이 최신 — 덮어쓰지 않는다.
    if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
    return pid;
  } catch {
    return null;
  }
}

/** v0(12개 개별 키) → v1 단일 키 → v2 프로젝트별 키를 순서대로 흡수. */
function migrateLegacyRecords(): void {
  const v0 = migrateV0();
  if (v0 && v0.currentProjectId != null) {
    const key = storageKeyFor(v0.currentProjectId);
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(v0));
  }
  migrateSingleKeyToPerProject();
}

function loadFromStorage(projectId: number): WorkspaceState {
  migrateLegacyRecords();
  const stored = localStorage.getItem(storageKeyFor(projectId));
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
      // v2 U3: recentChanges 는 세션 휘발 스토어로 이동 — 과거 영속 레코드의
      // 큰 배열(최대 1000건)은 읽지 않고 버린다 (blob 축소, 일방향).
      delete parsed.recentChanges;
      if (!parsed.fileExplorerExpanded || typeof parsed.fileExplorerExpanded !== "object") {
        parsed.fileExplorerExpanded = {};
      }
      // Lite-W6 PR6.3 + PR8 Part 2: side-panel width/mode persistence.
      // (sidePanelOpen was dropped above — PR-UI 7.)
      parsed.sidePanelWidth = migrateSidePanelWidth(parsed.sidePanelWidth);
      parsed.sidePanelMode = migrateSidePanelMode(parsed.sidePanelMode);
      // AI 오버레이 은퇴 (감사 2026-07-16): 오버레이 관련 영속 키는 전부
      // 일방향 삭제 — ⌘\ 는 이제 AI 패널 화면으로 이동한다.
      delete parsed.aiWorkbenchOpen;
      delete parsed.aiOverlayOpen;
      delete parsed.aiWorkbenchMode;
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
        // I3 — 창의 프로젝트는 URL 이 정한다. 과거 레코드에 남아 있는 값이
        // 이 창의 프로젝트를 덮어쓰지 못하게 마지막에 못박는다.
        currentProjectId: projectId,
      };
      return migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(merged)));
    } catch {
      // Corrupted data, start fresh
    }
  }

  return { ...DEFAULT_STATE, currentProjectId: projectId };
}

function persistToStorage(projectId: number, state: WorkspaceState) {
  // Only persist non-volatile fields
  const {
    indexingProjectId: _ip,
    indexProgress: _ipr,
    oculpmStatus: _os,
    currentSession: _cs,
    workdayKey: _wk,
    // I3 — 창 URL 이 단일 진실이라 프로젝트 신원은 영속하지 않는다.
    currentProjectId: _cpi,
    currentProjectName: _cpn,
    currentProjectRoot: _cpr,
    ...persistable
  } = state;
  localStorage.setItem(storageKeyFor(projectId), JSON.stringify(persistable));
}

// ---------- Context ----------

interface WorkspaceContextValue {
  state: WorkspaceState;
  setState: React.Dispatch<React.SetStateAction<WorkspaceState>>;

  // Convenience actions
  /**
   * 창의 프로젝트 **메타데이터**(이름·루트)만 채운다. id 는 창 URL 이 정하고
   * 런타임에 바뀌지 않으므로(I3) 여기서 바꿀 수 없다 — "프로젝트 전환"은
   * `commands.openProjectWindow` 로 다른 창을 포커스하는 것이다.
   */
  setProjectMeta: (name: string | null, root: string | null) => void;
  /** Final UI Update (ui_v2) — set the active screen of the 8-view shell. */
  setUiV2View: (view: UiV2View) => void;
  setActiveFile: (file: string | null) => void;
  setIndexing: (projectId: number | null, progress?: IndexProgress | null) => void;

  // .oculpm/ helpers (W3-PR4). Listeners in WorkspaceProvider keep these in
  // sync; screens call them directly when they need to refresh on demand.
  setOculpmStatus: (status: OculpmStatus | null) => void;
  setCurrentSession: (session: Session | null) => void;

  // v2 U3: markRecentChangeRead 는 recentChangesStore.markRead 로 이동.
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * 프로젝트 창 하나의 워크스페이스 상태. `projectId` 는 창 URL 이 정하며
 * 이 프로바이더의 수명 동안 고정이다 (I3) — 런처는 이 프로바이더를 아예
 * 마운트하지 않는다 (I2).
 */
export function WorkspaceProvider({
  projectId,
  children,
}: {
  projectId: number;
  children: ReactNode;
}) {
  const [state, setState] = useState<WorkspaceState>(() => loadFromStorage(projectId));

  // Keep a ref to the latest state so the event-listener effect and the
  // debounced persist can read fresh state without re-subscribing/re-arming.
  const stateRef = React.useRef<WorkspaceState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // v2 U3 — 디스크 동기화를 트레일링 디바운스로. 이전엔 상태 변경마다 전체
  // blob 을 동기 JSON.stringify → localStorage 기록했다. 언마운트/종료 시 flush.
  const persistTimer = React.useRef<number | null>(null);
  useEffect(() => {
    if (persistTimer.current != null) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      persistToStorage(projectId, stateRef.current);
    }, PERSIST_DEBOUNCE_MS);
  }, [state, projectId]);
  useEffect(() => {
    const flush = () => {
      if (persistTimer.current != null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
        persistToStorage(projectId, stateRef.current);
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [projectId]);

  const setProjectMeta = useCallback((name: string | null, root: string | null) => {
    setState((prev) =>
      prev.currentProjectName === name && prev.currentProjectRoot === root
        ? prev
        : { ...prev, currentProjectName: name, currentProjectRoot: root },
    );
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

  // `resetWorkspace` 는 멀티 창 라운드에서 제거됐다 — 유일한 호출처가
  // "대시보드로 돌아가기"였는데, I3 하에서 프로젝트 전환이 사라지면서
  // 창 상태의 수명이 곧 창의 수명이 됐다 (창을 닫으면 끝).

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

    // F1 — auto-reconcile applied status changes to the active plan in the
    // background. Toast so the user knows the plan moved on its own. Dedup per
    // plan within a short window so a burst of entries doesn't spam.
    void events.oculpmPlanReconciled.listen((evt) => {
      if (evt.payload.project_id !== currentProjectId()) return;
      const { applied, plan_id: planId } = evt.payload;
      toast.info(t("ws.reconciled", { n: applied }), {
        title: t("ws.reconciledTitle"),
        dedupKey: `reconciled:${planId}`,
        dedupWindowMs: 5_000,
      });
    }).then((off) => offFns.push(off));

    void events.oculpmAgentDrift.listen((evt) => {
      const pid = currentProjectId();
      if (evt.payload.project_id !== pid || pid == null) return;
      const { agent_id: agentId } = evt.payload;
      if (DriftCooldown.isDismissed(agentId)) return;
      toast.warning(
        t("ws.driftBody", { agent: agentId }),
        {
          title: t("ws.driftTitle"),
          dedupKey: `drift:${agentId}`,
          dedupWindowMs: 60_000,
          durationMs: 0, // sticky until user acts
          actions: [
            {
              label: t("ws.driftSync"),
              onClick: () => {
                if (pid == null) return;
                oculpmApi
                  .syncAgents(pid)
                  .then((report) => {
                    const updated = report.results.filter(
                      (r) => r.action === "inserted" || r.action === "updated",
                    ).length;
                    DriftCooldown.clear(agentId);
                    toast.info(t("ws.driftSynced", { n: updated }));
                  })
                  .catch((e) => {
                    const msg = e instanceof OculpmApiError ? e.message : String(e);
                    toast.destructive(t("ws.driftSyncFailed", { error: msg }));
                  });
              },
            },
            {
              label: t("ws.driftIgnore"),
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

    // Lite-W6 PR8 Part 1: feed the change-highlight buffer.
    // v2 U3: 컨텍스트 setState 가 아니라 전용 스토어로 push — 파일 이벤트가
    // 전 화면 리렌더 + localStorage 직렬화를 일으키던 경로를 제거.
    void events.oculpmFileChanged.listen((evt) => {
      if (evt.payload.project_id !== currentProjectId()) return;
      const op = mapFileOpToChangeOp(evt.payload.event.op);
      const path = evt.payload.event.path;
      // Dogfooding (2026-06-07) — forbidden-path matches arrive pre-masked as
      // `**redacted/sensitive**:<hash>`. They can't be opened (computeDiff has
      // no real path) and are pure noise in the 변경 diff list, so drop them
      // here. The ndjson/journal masking on the backend is untouched.
      if (path.startsWith("**redacted/sensitive**")) return;
      recentChangesStore.push({
        path,
        op,
        ts: Date.now(),
        // Lite-W6 PR6.5: every fresh watcher event starts unread so the
        // diff view can surface "new since you last looked".
        read: false,
      });
    }).then((off) => offFns.push(off));

    void events.oculpmJournalAdded.listen((evt) => {
      if (evt.payload.project_id !== currentProjectId()) return;
      toast.info(t("ws.newEntry", { title: evt.payload.summary.title }), {
        dedupKey: `journal_added:${evt.payload.summary.relative_path}`,
      });
    }).then((off) => offFns.push(off));
    void events.oculpmJournalUpdated.listen(() => {}).then((off) => offFns.push(off));

    return () => {
      offFns.forEach(safeUnlisten);
    };
  }, [setCurrentSession]);

  // ── Workday rollover (자정 넘김) ─────────────────────────────────────────
  // status(→ workdayKey / current_workday)는 프로젝트를 열 때 App.tsx 에서
  // 딱 한 번만 조회된다. 그래서 앱(특히 메뉴바 상주)을 계속 켜 두면 실행한
  // 그 날짜에 고정돼, 00시가 지나도 "오늘" 화면·날짜 라벨·주간 차트가 앱을
  // 껐다 켜기 전까지 어제를 가리킨다.
  //
  // 백엔드에서 workday 를 다시 계산해(프로젝트 tz + day_starts_at 존중) 실제로
  // 넘어갔을 때만 커밋한다 — 가드 덕분에 매 tick 마다 트리를 리렌더하지 않고
  // 하루 한 번 경계에서만 갱신된다. 60초 주기 tick 에 더해 창 포커스/탭
  // 재표시(슬립 복귀 시 throttle 됐던 타이머가 밀린 경우) 시에도 확인한다.
  useEffect(() => {
    let inFlight = false;

    const check = async () => {
      const projectId = stateRef.current?.currentProjectId ?? null;
      // .oculpm 이 초기화된 프로젝트만 넘길 workday 가 있다.
      if (projectId == null || inFlight || !stateRef.current?.oculpmEnabled) return;
      inFlight = true;
      try {
        const status = await oculpmApi.getStatus(projectId);
        // 요청 도중 프로젝트가 바뀌었으면 버린다.
        if (stateRef.current?.currentProjectId !== projectId) return;
        if (status.current_workday !== stateRef.current?.oculpmStatus?.current_workday) {
          setOculpmStatus(status);
        }
      } catch {
        // 일시적 실패 — 다음 tick 에서 재시도한다. 롤오버는 토스트할 일이 아니다.
      } finally {
        inFlight = false;
      }
    };

    const id = window.setInterval(() => void check(), 60_000);
    const onWake = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [setOculpmStatus]);

  // v2 U3 — Provider 리렌더마다 새 객체를 만들지 않는다. 콜백은 전부
  // useCallback([]) 로 안정적이므로 value 는 사실상 state 에만 종속된다.
  const value = useMemo<WorkspaceContextValue>(
    () => ({
      state,
      setState,
      setProjectMeta,
      setUiV2View,
      setActiveFile,
      setIndexing,
      setOculpmStatus,
      setCurrentSession,
    }),
    [
      state,
      setProjectMeta,
      setUiV2View,
      setActiveFile,
      setIndexing,
      setOculpmStatus,
      setCurrentSession,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return ctx;
}

/**
 * 런처 창처럼 워크스페이스가 **없을 수도 있는** 곳에서 쓰는 접근자 (I2).
 * 두 창에서 함께 렌더되는 공용 컴포넌트(⌘K 팔레트·설정 패널)가 프로젝트에
 * 매인 기능만 조용히 끄고 나머지는 그대로 동작하게 한다.
 */
export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}
