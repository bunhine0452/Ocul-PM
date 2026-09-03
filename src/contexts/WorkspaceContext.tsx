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

import { commands, events, type FileOp, type OculpmStatus, type Session } from "@/lib/bindings";
import type { PlanGroup, PlanSort } from "@/features/planner/planList";
import type { CodeTabsState } from "@/features/code/codeTabs";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { toast, DriftCooldown } from "@/lib/toast";
import { pushIntegrityWarning } from "@/lib/integrityLog";
import { openSettings } from "@/lib/settingsNav";
import { NAV_BUS, type OpenEntityDetail } from "@/lib/navRegistry";
import { recentChangesStore, type ChangeOp } from "@/lib/recentChangesStore";
// 이벤트 리스너 안에서 부르는 토스트라 훅이 아닌 모듈 t() 가 맞다
// (구독 시점이 아니라 **발생 시점**의 언어를 읽어야 한다).
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";

// v2 U3 — recentChanges 는 전용 외부 스토어로 분리됐다 (아래 주석 및
// docs/20260706_v2/03-performance-spec.md §1). 기존 임포트 경로 호환을 위해
// 타입/헬퍼를 재수출한다.
export { pushRecentChange, RECENT_CHANGES_CAP, recentChangesStore, useRecentChanges } from "@/lib/recentChangesStore";
export type { RecentChange, ChangeOp } from "@/lib/recentChangesStore";
import { DEFAULT_STATE, WORKSPACE_SCHEMA_VERSION } from "./workspaceDefaults";
export { WORKSPACE_SCHEMA_VERSION };

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
  | "codex"
  // 코드 화면 (docs/code-editor/00-master-plan.md) — 인앱 코드 뷰어·에디터.
  | "code"
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
/** 문제 해결 편집기의 보기 모드 — 원문만 / 나란히 / 미리보기만. */
export type DiscussionEditorMode = "write" | "split" | "preview";
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
/** 터미널 도크를 붙이는 자리 (2026-08-15, 오른쪽 추가 2026-08-16). */
export type TerminalDockPos = "bottom" | "left" | "right";

/**
 * 자리 바꾸기 버튼의 다음 자리 — 아래 → 왼쪽 → 오른쪽 → 아래.
 *
 * 버튼 하나로 도는 이유는 자리가 셋뿐이고, 세그먼티드 컨트롤을 놓기엔 도크
 * 헤더가 좁기 때문이다 (탭 줄을 탭에게서 뺏는다). 아래에서 시작하는 것은
 * 터미널이 가장 자주 놓이는 자리라서다.
 */
export function nextDockPos(pos: TerminalDockPos): TerminalDockPos {
  return pos === "bottom" ? "left" : pos === "left" ? "right" : "bottom";
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
  /**
   * 첫 활성화 카드 (완성도 라운드 Phase 2, 2026-08-30). `oculpm_init` 이
   * config.toml 을 **새로** 쓴 탭이 채우고, Today 가 「알겠어요」 로 비운다.
   * 영속: 카드를 보기 전에 앱을 닫아도 다음에 보인다.
   */
  oculpmInitCard: OculpmInitCardInfo | null;

  // Volatile (not persisted)
  /** 색인 중인 프로젝트 — 진행률 자체는 `lib/indexProgressStore` (컨텍스트 밖). */
  indexingProjectId: number | null;

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
  /**
   * 계획 레일의 폭 (px) · 붙는 쪽 (2026-09-03 정리 라운드).
   *
   * 제목이 긴 계획이 많아지면 236px 은 전부 말줄임표가 된다 — 폭은 계획 이름
   * 길이에 달린 값이라 상수로 정할 수 없다. 쪽은 코드 화면 트리와 같은
   * 취향 문제다 (`codeSidebarSide`). 알 수 없는 값은 소비처가 왼쪽으로 본다.
   */
  plannerRailWidth: number;
  plannerRailSide: "left" | "right";
  /** 코드 검색 scope. */
  searchScope: SearchScope;
  /** 최근 검색어 (최대 10개). */
  searchRecent: string[];
  /** 터미널 탭 목록 (PTY 핸들은 휘발성 — 여기엔 메타만). */
  terminalTabs: TerminalTab[];
  /** 활성 터미널 탭 id. */
  terminalActiveId: string | null;
  // (terminalFontSize 는 2026-08-15 에 앱 전역 설정으로 나갔다 — SQLite
  //  `terminal_font_size`. 프로젝트마다 다를 이유가 없는 개인 취향이고, 설정
  //  화면은 프로젝트가 없을 때도 열리며, 창을 여러 개 띄워도 한 값이어야
  //  한다. 과거 레코드의 키는 loadFromStorage 에서 일방향 삭제된다.)
  /**
   * 터미널 도크 (2026-08-15) — 어느 화면에서나 ⌘J 로 여는 터미널 패널.
   *
   * 세션은 터미널 **화면과 같은 것**을 쓴다 (위 `terminalTabs` 를 공유). 같은
   * PTY 에 xterm 두 개가 동시에 붙으면 리사이즈가 서로 싸우므로, 한 번에 한
   * 면만 마운트한다 — 소유권 판정은 `ShellV2` 가 한다 (분리 창 > 터미널 화면
   * > 도크).
   */
  terminalDockOpen: boolean;
  /** 도크를 붙이는 자리 — 하단(가로 폭 우선)/왼쪽(세로 길이 우선). */
  terminalDockPos: TerminalDockPos;
  /** 하단 도크 높이(px) — 자리마다 크기를 따로 기억한다. */
  terminalDockHeight: number;
  /** 왼쪽 도크 폭(px). */
  terminalDockWidth: number;
  /**
   * 이 프로젝트의 터미널이 **분리 창**에 나가 있다.
   *
   * 휘발성이다 — 진실은 창의 존재 여부이고, 백엔드
   * (`TerminalWindowsChanged`)가 알려 주는 것을 미러링만 한다. 나가 있는
   * 동안 이 창은 터미널 세션 필드를 디스크에 쓰지 않는다: 두 창이 같은
   * 영속 키를 공유하는데, 여기서 낡은 탭 목록을 덮어쓰면 분리 창에서 만든
   * 탭이 되돌아올 때 증발한다.
   */
  terminalDetached: boolean;
  /** 에이전트 화면 활성 모델 id. */
  aiActiveModel: string | null;
  /** Claude Code 화면의 대화 목록 패널이 열려 있는지 (PR-ACP7). */
  acpPanelOpen: boolean;
  /**
   * 열어 둔 세션 탭 (PR-ACP14).
   *
   * 백엔드는 프로젝트당 연결 하나·활성 세션 하나만 안다. 탭은 그 위에 얹은
   * **프런트 개념**이다 — "내가 오가며 보는 대화들"의 목록이고, 전환은
   * `session/load` 로 그 세션을 다시 여는 것이다. 그래서 백엔드에 새 개념을
   * 만들지 않고도 성립한다.
   */
  acpTabs: { id: string; title: string | null }[];
  /** Codex ACP tabs are isolated from Claude sessions in the same project. */
  codexAcpTabs: { id: string; title: string | null }[];
  /**
   * 사용자가 대화에 붙인 이름표 (세션 id → 이름).
   *
   * 에이전트에게 못 보낸다 — ACP 에는 제목을 고치는 요청이 없다(지우기는 있다).
   * 그래서 이 이름은 **이 컴퓨터 안에서만** 유효하고, 다른 기기나 CLI 에서 같은
   * 대화를 열면 에이전트가 붙인 원래 제목이 보인다.
   */
  acpNames: Record<string, string>;
  codexAcpNames: Record<string, string>;
  /**
   * 마지막으로 보고 있던 대화의 id.
   *
   * 앱을 다시 띄우면(업데이트 재시작 포함) 어댑터는 새 프로세스라 대화가 없다 —
   * 하지만 대화 자체는 디스크에 남아 있다. 이 값이 있으면 그 대화를 도로 열어
   * "하던 곳"으로 돌아간다. 없거나 이미 지워졌으면 빈 화면으로 시작한다.
   */
  acpLastSession: string | null;
  codexAcpLastSession: string | null;
  /**
   * Effort 트랙의 **마지막 칸**(울트라코드) 선택 여부.
   *
   * 어댑터의 effort 값은 `low…max` 다섯 개뿐이고 울트라코드는 그 목록에
   * 없다 — 사용자 쪽 Claude Code 는 `max` 다음 칸에 두고 "xhigh + workflows"
   * 라 설명한다. 즉 **값이 아니라 키워드로 켜지는 상태**라서 우리가 따로
   * 들고 있어야 한다. 비싼 모드이므로 켠 사실이 계속 보여야 하고, 그래서
   * 영속한다.
   */
  acpUltracode: boolean;
  /** AI 패널 + 오버레이가 공유하는 thread id. */
  aiThreadId: string | null;
  /** 문서(docs) 화면에서 마지막으로 본 문서의 프로젝트-루트 기준 경로 (예: docs/README.md). */
  docsActivePath: string | null;
  /** 코드 화면에서 마지막으로 열었던 파일의 프로젝트-루트 기준 경로. */
  codeActivePath: string | null;
  /**
   * 코드 화면의 탭·분할 상태 (Phase 1 #tabs-persist). 열어 둔 파일 목록은
   * 편집기에서 **작업 중인 자리** 그 자체라, 앱을 껐다 켜면 되살아나야 한다.
   *
   * 미저장 편집 자체는 여기 없다 — 버퍼는 의도적으로 영속하지 않는다
   * (codeBuffers 의 주석: 디스크와 다른 유령 버퍼가 되살아나는 쪽이 더 위험).
   * 즉 되살아나는 것은 "무엇을 열어 뒀는가" 뿐이고, 내용은 디스크에서 다시 읽는다.
   */
  codeTabs: CodeTabsState | null;
  /**
   * 코드 화면 하단 패널(참조·디버그)의 높이 px (#panel-resize). 두 패널이
   * 같은 자리를 쓰므로 높이도 하나다 — 패널마다 따로 기억하면 참조에서 디버그로
   * 넘어갈 때마다 바닥이 널뛴다.
   */
  codePanelHeight: number;
  /**
   * 코드 화면 파일 트리를 붙이는 쪽 (2026-08-24). 왼쪽이 기본 — 오른손
   * 마우스로 트리를 쓰거나 편집면을 왼쪽 끝에 붙이고 싶은 사람이 옮긴다.
   * 알 수 없는 값은 소비처가 왼쪽으로 취급한다.
   */
  codeSidebarSide: "left" | "right";
  /**
   * 코드 화면 전역 검색의 매칭 토글 (#project-search). 검색어·결과는 휘발이지만
   * 대소문자·단어·정규식 습관은 사람에게 붙는 설정이라 여기 남긴다.
   */
  codeSearchOpts: { caseSensitive: boolean; wholeWord: boolean; regex: boolean };
  /** 문제 해결(Discussion) 화면에서 마지막으로 본 토의 문서의 id (frontmatter slug). */
  discussionActiveId: string | null;
  /**
   * 문제 해결 편집기의 보기 모드 (원문만 / 나란히 / 미리보기만). 문서마다가
   * 아니라 사람마다 고정된 습관이라 화면 단위로 기억한다.
   */
  discussionEditorMode: DiscussionEditorMode;
  /**
   * 사이드바 접힘 상태 (Dogfooding 2026-06-07). true 면 사이드바가 화면에서
   * 사라지고, 좌측 가장자리 호버 시에만 오버레이로 떠오름. 영속.
   */
  sidebarCollapsed: boolean;
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
/** 첫 init 이 저장소에 쓴 것 — Today 첫 활성화 카드의 내용. */
export interface OculpmInitCardInfo {
  createdDirs: string[];
  wroteConfig: boolean;
  wroteGitignore: boolean;
  /** 프로젝트 상대 경로 (`AGENTS.md` 등) — sync_agents 가 이번에 넣거나 고친 것. */
  agentFiles: string[];
  /** `Date.now()` 기록 시각. */
  at: number;
}


/**
 * 창 하나 = 프로젝트 하나이므로 영속 키도 프로젝트별이다 (멀티 창 T3/R3).
 * 테스트가 키를 하드코딩하지 않도록 export 한다.
 */
export const storageKeyFor = (projectId: number) => `aipm:workspace:v2:p${projectId}`;

// ---------- 사이드바 접힘 — 창/탭을 가로지르는 단일 취향 ----------
//
// 접힘 상태는 프로젝트별 레코드 안에 있었다. 탭 하나 = 프로바이더 하나이므로
// 탭을 옮길 때마다 사이드바가 제 마음대로 열리고 닫혔다 — 프로젝트의 속성이
// 아니라 **사람의 취향**인데 프로젝트에 매여 있었던 것. 전용 키 하나로 빼고,
// 같은 창의 다른 탭에는 구독자 집합으로, 다른 창에는 `storage` 이벤트로
// 전파한다 (`storage` 는 값을 쓴 문서 자신에겐 발화하지 않는다).
export const SIDEBAR_KEY = "aipm:ui:sidebar-collapsed:v1";

type SidebarListener = (collapsed: boolean) => void;
const sidebarListeners = new Set<SidebarListener>();

/** 저장된 취향 (한 번도 정한 적 없으면 `null`). */
function readSidebarCollapsed(): boolean | null {
  const raw = localStorage.getItem(SIDEBAR_KEY);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

/** 취향을 기록하고 같은 창의 다른 탭에 알린다. 값이 그대로면 아무것도 안 한다. */
function writeSidebarCollapsed(collapsed: boolean) {
  if (readSidebarCollapsed() === collapsed) return;
  localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  sidebarListeners.forEach((fn) => fn(collapsed));
}

/** 다른 탭·다른 창의 변경 구독. 반환값은 해지 함수. */
function subscribeSidebar(fn: SidebarListener): () => void {
  sidebarListeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SIDEBAR_KEY) return;
    const next = readSidebarCollapsed();
    if (next !== null) fn(next);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    sidebarListeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

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

/**
 * 터미널 도크 크기 하한 — 이보다 얇으면 xterm 이 한 줄도 못 그려 "열려 있는데
 * 아무것도 없는" 상태가 된다.
 */
export const TERMINAL_DOCK_MIN = 120;
/** 남는 화면이 이만큼은 있어야 한다 — 도크가 콘텐츠를 완전히 밀어내지 못하게. */
export const TERMINAL_DOCK_MIN_REST = 160;

/**
 * 드래그·영속값을 쓸 수 있는 범위로 자른다. `container` 는 도크가 놓인 축의
 * 전체 길이(px)로, 0 이하(아직 레이아웃 전)면 하한만 적용한다.
 */
export function clampDockSize(px: number, container: number): number {
  const wanted = Number.isFinite(px) ? Math.round(px) : TERMINAL_DOCK_MIN;
  if (!(container > 0)) return Math.max(TERMINAL_DOCK_MIN, wanted);
  const max = Math.max(TERMINAL_DOCK_MIN, container - TERMINAL_DOCK_MIN_REST);
  return Math.min(max, Math.max(TERMINAL_DOCK_MIN, wanted));
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
  const globalSidebar = readSidebarCollapsed();
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
      // 터미널 글자 크기는 앱 전역 설정으로 나갔다 (2026-08-15) — 일방향.
      delete parsed.terminalFontSize;
      delete parsed.aiWorkbenchOpen;
      delete parsed.aiOverlayOpen;
      delete parsed.aiWorkbenchMode;
      // Merge with defaults to handle new fields added in future versions
      const merged = {
        ...DEFAULT_STATE,
        ...parsed,
        // Always reset volatile state
        indexingProjectId: null,
        oculpmEnabled: false,
        oculpmStatus: null,
        currentSession: null,
        workdayKey: null,
        // 분리 창의 존재 여부는 백엔드가 알려 준다 — 지난 실행의 값을 믿고
        // 시작하면 창이 없는데 자리표시자만 뜬 상태로 굳는다.
        terminalDetached: false,
        // I3 — 창의 프로젝트는 URL 이 정한다. 과거 레코드에 남아 있는 값이
        // 이 창의 프로젝트를 덮어쓰지 못하게 마지막에 못박는다.
        currentProjectId: projectId,
        // 사이드바 접힘은 전역 키가 진실이다. 전역 값이 아직 없으면 이 레코드에
        // 남아 있는 예전 값을 한 번 승격시킨다 (탭마다 다르면 먼저 연 탭이
        // 이긴다 — 어차피 다음 토글이 전역으로 통일한다).
        sidebarCollapsed: globalSidebar ?? parsed.sidebarCollapsed ?? DEFAULT_STATE.sidebarCollapsed,
      };
      if (globalSidebar === null) writeSidebarCollapsed(merged.sidebarCollapsed);
      return migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(merged)));
    } catch {
      // Corrupted data, start fresh
    }
  }

  return {
    ...DEFAULT_STATE,
    currentProjectId: projectId,
    sidebarCollapsed: globalSidebar ?? DEFAULT_STATE.sidebarCollapsed,
  };
}

interface TerminalSessionFields {
  terminalTabs: TerminalTab[];
  terminalActiveId: string | null;
}

/** 디스크에 있는 레코드 (파싱 실패·부재는 `null`). */
function readRecord(projectId: number): Record<string, unknown> | null {
  const stored = localStorage.getItem(storageKeyFor(projectId));
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 영속 레코드에서 터미널 세션 필드만 떼어 온다 (없으면 `null`). */
function readTerminalSessions(projectId: number): TerminalSessionFields | null {
  const parsed = readRecord(projectId);
  if (!parsed || !Array.isArray(parsed.terminalTabs)) return null;
  return {
    terminalTabs: parsed.terminalTabs as TerminalTab[],
    terminalActiveId: (parsed.terminalActiveId ?? null) as string | null,
  };
}

/**
 * 이 프로바이더가 영속 레코드의 **어디까지를 소유하는가**.
 *
 * 분리 터미널 창(2026-08-15)이 생기면서 한 프로젝트의 레코드를 창 둘이 함께
 * 쓰게 됐다. 둘 다 통째로 쓰면 나중에 저장한 쪽이 상대의 변경을 지운다 —
 * 그래서 각자 자기 몫만 쓰고 나머지는 **디스크에 있는 값을 그대로 남긴다.**
 *
 *  - `full`     : 앱 창. 단, 터미널이 나가 있으면(`terminalDetached`) 터미널
 *                 세션 필드는 건드리지 않는다.
 *  - `terminal` : 분리 터미널 창. 터미널 세션 필드만 쓴다.
 */
export type PersistScope = "full" | "terminal";

function persistToStorage(projectId: number, state: WorkspaceState, scope: PersistScope) {
  // Only persist non-volatile fields
  const {
    indexingProjectId: _ip,
    // 상태에서 파생되는 값 — 지난 실행의 true 를 믿으면 상태가 오기 전에
    // 워크데이 조회가 돈다 (Phase 4 에서 영속 제외).
    oculpmEnabled: _oe,
    oculpmStatus: _os,
    currentSession: _cs,
    workdayKey: _wk,
    // 분리 창의 존재 여부는 백엔드가 소유한다 (창이 살아 있는지가 진실).
    terminalDetached: _td,
    // I3 — 창 URL 이 단일 진실이라 프로젝트 신원은 영속하지 않는다.
    currentProjectId: _cpi,
    currentProjectName: _cpn,
    currentProjectRoot: _cpr,
    // 사이드바 접힘은 프로젝트가 아니라 사람에게 딸린 취향이다 — 전용 전역 키가
    // 소유한다 (`SIDEBAR_KEY`). 레코드에 남기면 탭마다 다시 갈라진다.
    sidebarCollapsed: _sc,
    ...persistable
  } = state;

  let record: Record<string, unknown> = persistable;
  if (scope === "terminal") {
    // 터미널 창은 셸만 안다. 화면·필터 같은 나머지는 앱 창이 계속 바꾸고
    // 있으므로, 우리가 마운트할 때 읽은 스냅샷으로 되돌리면 안 된다.
    const disk = readRecord(projectId);
    record = {
      ...(disk ?? persistable),
      terminalTabs: state.terminalTabs,
      terminalActiveId: state.terminalActiveId,
    };
  } else if (state.terminalDetached) {
    // 반대쪽 — 지금 셸의 주인은 분리 창이다. 여기서 우리 메모리의 낡은 탭
    // 목록을 얹으면 분리 창이 방금 만든 탭이 조용히 사라진다.
    const held = readTerminalSessions(projectId);
    if (held) record = { ...persistable, ...held };
  }
  localStorage.setItem(storageKeyFor(projectId), JSON.stringify(record));
}

// ---------- 조각 (Phase 4 #workspace-split) ----------
//
// 상태 객체 하나에 40여 필드가 살고 `value` 가 그 전체에 매여 있어, 검색어
// 하나가 바뀌어도 터미널·플래너·코드 화면이 전부 다시 그려졌다. 단일 진실은
// 그대로 두되(원자적 갱신·영속 레코드 모양 불변) **읽는 쪽을 셋으로 가른다**:
// 런타임(프로젝트 신원·oculpm 상태·색인 중·분리 창), 터미널 세션(두 창이
// 함께 쓰는 유일한 조각), UI 취향(나머지 영속 필드). 각 조각은 자기 키가
// 바뀔 때만 새 참조가 되므로 `useUiPrefs()` 를 쓰는 화면은 터미널 탭이 바뀌어도
// 조용하다. `useWorkspace()` 는 합친 겉면으로 남는다.

const RUNTIME_KEYS = [
  "currentProjectId",
  "currentProjectName",
  "currentProjectRoot",
  "indexingProjectId",
  "oculpmEnabled",
  "oculpmStatus",
  "currentSession",
  "workdayKey",
  "terminalDetached",
  "sidebarCollapsed",
] as const satisfies readonly (keyof WorkspaceState)[];
const TERMINAL_KEYS = ["terminalTabs", "terminalActiveId"] as const satisfies readonly (keyof WorkspaceState)[];

export type RuntimeSlice = Pick<WorkspaceState, (typeof RUNTIME_KEYS)[number]>;
export type TerminalSlice = Pick<WorkspaceState, (typeof TERMINAL_KEYS)[number]>;
export type UiPrefsSlice = Omit<WorkspaceState, keyof RuntimeSlice | keyof TerminalSlice>;

function pickSlice<K extends keyof WorkspaceState>(
  state: WorkspaceState,
  keys: readonly K[],
): Pick<WorkspaceState, K> {
  const out = {} as Pick<WorkspaceState, K>;
  for (const k of keys) out[k] = state[k];
  return out;
}

function omitKeys(state: WorkspaceState, keys: ReadonlySet<string>): UiPrefsSlice {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) if (!keys.has(k)) out[k] = v;
  return out as UiPrefsSlice;
}

/** 조각의 키가 하나라도 `Object.is` 로 다를 때만 새 객체 — 아니면 이전 참조. */
function useStableSlice<T extends object>(next: T): T {
  const ref = React.useRef(next);
  const prev = ref.current;
  const same =
    prev === next ||
    (Object.keys(next).length === Object.keys(prev).length &&
      Object.keys(next).every((k) => Object.is((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k])));
  if (!same) ref.current = next;
  return ref.current;
}

const NON_PREFS_KEYS: ReadonlySet<string> = new Set<string>([...RUNTIME_KEYS, ...TERMINAL_KEYS]);

export interface ProjectRuntimeValue extends RuntimeSlice {
  setProjectMeta: (name: string | null, root: string | null) => void;
  setTerminalDetached: (detached: boolean) => void;
  setIndexing: (projectId: number | null) => void;
  setOculpmStatus: (status: OculpmStatus | null) => void;
  setCurrentSession: (session: Session | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export interface UiPrefsValue {
  prefs: UiPrefsSlice;
  /** 취향 일부만 바꾼다 — 돌려준 조각만 합친다. */
  setPrefs: (updater: (prev: UiPrefsSlice) => Partial<UiPrefsSlice>) => void;
  setUiV2View: (view: UiV2View) => void;
}

export interface TerminalSessionsValue extends TerminalSlice {
  /** 세션 목록·활성 탭을 함께 바꾼다 (같은 참조를 돌려주면 조용하다). */
  setSessions: (updater: (prev: TerminalSlice) => TerminalSlice) => void;
  selectTab: (id: string) => void;
  patchTab: (id: string, fn: (tab: TerminalTab) => TerminalTab) => void;
  /** 탭을 하나 더 열고 활성화한다 — 화면도 옮길 수 있다 (Claude Code 「터미널에서」). */
  openTab: (tab: TerminalTab, opts?: { view?: UiV2View }) => void;
}

const ProjectRuntimeContext = createContext<ProjectRuntimeValue | null>(null);
const UiPrefsContext = createContext<UiPrefsValue | null>(null);
const TerminalSessionsContext = createContext<TerminalSessionsValue | null>(null);

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
  /**
   * 분리 터미널 창의 존재 여부 반영 (백엔드 이벤트 미러링). 돌아올 때
   * 디스크의 터미널 세션 목록을 다시 읽어 들인다.
   */
  setTerminalDetached: (detached: boolean) => void;
  setActiveFile: (file: string | null) => void;
  /** 색인 시작/끝만 — 파일별 진행률은 `indexProgressStore` 로 (Phase 3). */
  setIndexing: (projectId: number | null) => void;

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
  persistScope = "full",
  children,
}: {
  projectId: number;
  /**
   * 이 창이 영속 레코드의 어디까지를 소유하는가 (`PersistScope`). 분리 터미널
   * 창만 `"terminal"` 을 쓴다 — 앱 창과 레코드를 공유하기 때문이다.
   */
  persistScope?: PersistScope;
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
      persistToStorage(projectId, stateRef.current, persistScope);
    }, PERSIST_DEBOUNCE_MS);
  }, [state, projectId, persistScope]);
  useEffect(() => {
    const flush = () => {
      if (persistTimer.current != null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
        persistToStorage(projectId, stateRef.current, persistScope);
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [projectId, persistScope]);

  // 사이드바 접힘 — 전역 키에 쓰고, 다른 탭/창의 변경을 받아 반영한다.
  // 디바운스 없이 즉시 쓴다: 토글은 사람 손이라 드물고, 옆 탭이 바로 따라와야
  // "탭마다 따로 논다" 는 인상이 사라진다.
  useEffect(() => {
    writeSidebarCollapsed(state.sidebarCollapsed);
  }, [state.sidebarCollapsed]);
  useEffect(
    () =>
      subscribeSidebar((collapsed) =>
        setState((prev) =>
          prev.sidebarCollapsed === collapsed ? prev : { ...prev, sidebarCollapsed: collapsed },
        ),
      ),
    [],
  );

  // 터미널 세션의 잃어버린 갱신 (Phase 4 #workspace-split).
  //
  // 분리 창과 앱 창이 한 레코드를 함께 쓴다. 쓰기는 이미 자기 몫만 쓰지만
  // **읽기**가 없었다 — 상대가 탭을 만들어도 이쪽 메모리는 떠날 때의 스냅샷
  // 그대로였고, `terminalDetached` 가 늦게 오면 그 낡은 목록이 통째로
  // 저장됐다. `storage` 이벤트(다른 문서의 쓰기에만 발화)로 상대가 남긴
  // 터미널 필드를 곧장 받아들인다 — 이제 어느 창이 언제 저장하든 최신 목록이다.
  useEffect(() => {
    const key = storageKeyFor(projectId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      const held = readTerminalSessions(projectId);
      if (!held) return;
      setState((prev) => {
        const owner = persistScope === "terminal" || prev.terminalDetached;
        if (!owner) return prev;
        if (prev.terminalTabs === held.terminalTabs && prev.terminalActiveId === held.terminalActiveId) return prev;
        if (
          JSON.stringify(prev.terminalTabs) === JSON.stringify(held.terminalTabs) &&
          prev.terminalActiveId === held.terminalActiveId
        )
          return prev;
        return { ...prev, ...held };
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId, persistScope]);

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

  /**
   * 분리 터미널 창의 존재 여부를 반영한다 (백엔드 이벤트가 유일한 출처).
   *
   * 돌아오는 순간(true → false)에는 디스크에서 터미널 세션 필드를 다시 읽는다
   * — 나가 있는 동안 탭을 만들고 지운 것은 분리 창 쪽이고, 이 창의 메모리에
   * 있는 목록은 떠날 때의 스냅샷이라 그대로 쓰면 그 작업이 사라진다.
   */
  const setTerminalDetached = useCallback(
    (detached: boolean) => {
      setState((prev) => {
        if (prev.terminalDetached === detached) return prev;
        if (detached) return { ...prev, terminalDetached: true };
        const held = readTerminalSessions(projectId);
        return { ...prev, terminalDetached: false, ...(held ?? {}) };
      });
    },
    [projectId],
  );

  const setActiveFile = useCallback((file: string | null) => {
    setState((prev) => ({ ...prev, activeFile: file }));
  }, []);

  const setIndexing = useCallback((projectId: number | null) => {
    setState((prev) =>
      prev.indexingProjectId === projectId ? prev : { ...prev, indexingProjectId: projectId },
    );
  }, []);

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
      // 닥터(설정 → 진단)가 세션 기록을 보여 준다 — 토스트는 8초면 사라진다.
      pushIntegrityWarning(evt.payload.project_id, w);
      // W4-PR8: surface as warning toast. Dedup per (kind, path) within 30s so
      // a single bad file doesn't spam repeated re-saves.
      toast.warning(w.message, {
        title: `[${w.kind}] ${w.path}`,
        // `.oculpm` 상대 경로는 프로젝트끼리 겹친다 (planner/main.md 등).
        dedupKey: `integrity:${evt.payload.project_id}:${w.kind}:${w.path}`,
        actions: [{ label: t("ws.viewInDoctor"), onClick: () => openSettings("diagnostics") }],
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
        dedupKey: `reconciled:${evt.payload.project_id}:${planId}`,
        dedupWindowMs: 5_000,
      });
    }).then((off) => offFns.push(off));

    // 다른 ocul-pm 인스턴스가 이 프로젝트를 가져갔다 (2026-08-23). 이 창은
    // 실시간 갱신을 놓았으므로 **말해 줘야 한다** — 예전에는 화면이 조용히
    // 굳고, 사용자는 새로고침을 반복하는 것 말고 알 방법이 없었다.
    void events.oculpmWatchYielded.listen((evt) => {
      const pid = currentProjectId();
      if (evt.payload.project_id !== pid || pid == null) return;
      toast.warning(t("ws.watchYielded"), {
        title: t("ws.watchYieldedTitle"),
        dedupKey: `watch-yielded:${pid}`,
        dedupWindowMs: 60_000,
        durationMs: 0,
        actions: [
          {
            label: t("watcher.takeOver"),
            onClick: () => {
              void (async () => {
                const r = await commands.oculpmWatcherTakeOver(pid);
                if (r.status === "ok") toast.info(t("watcher.tookOver"));
                else toast.destructive(t("watcher.takeOverFailed", { error: tError(r.error) }));
              })();
            },
          },
        ],
      });
    }).then((off) => offFns.push(off));

    void events.oculpmAgentDrift.listen((evt) => {
      const pid = currentProjectId();
      if (evt.payload.project_id !== pid || pid == null) return;
      const { agent_id: agentId } = evt.payload;
      if (DriftCooldown.isDismissed(pid, agentId)) return;
      toast.warning(
        t("ws.driftBody", { agent: agentId }),
        {
          title: t("ws.driftTitle"),
          // agentId 는 어느 프로젝트에서나 같다 — 프로젝트를 빼면 B 의 경고가 삼켜진다.
          dedupKey: `drift:${pid}:${agentId}`,
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
                    DriftCooldown.clear(pid, agentId);
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
              onClick: () => DriftCooldown.dismiss(pid, agentId),
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
      // 버킷은 **이벤트가 말한 프로젝트**다 — 이 프로바이더의 것과 같음은 위
      // 가드가 이미 보장한다. 한 창에 탭이 여럿이면 이 모듈은 하나뿐이라,
      // 버킷 없이 밀면 옆 탭의 「미기록 변경」에 그대로 샌다.
      recentChangesStore.push(evt.payload.project_id, {
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
      const relativePath = evt.payload.summary.relative_path;
      toast.info(t("ws.newEntry", { title: evt.payload.summary.title }), {
        dedupKey: `journal_added:${relativePath}`,
        // 「열기」 — 셸의 open-entity 버스로 일지 상세까지 간다 (검토 루프의 첫 고리).
        actions: [
          {
            label: t("ws.openEntry"),
            onClick: () => {
              const detail: OpenEntityDetail = { kind: "journal", id: relativePath };
              window.dispatchEvent(new CustomEvent(NAV_BUS.openEntity, { detail }));
            },
          },
        ],
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

    // Phase 4 #events-over-polling — 60초 폴링 대신 백엔드의 넘김 이벤트(활성
    // 세션의 경계 타이머 + 감독관의 분당 틱). 포커스/재표시 확인은 남긴다:
    // 슬립 중엔 이벤트도 타이머도 밀린다.
    let off: (() => void) | undefined;
    void events.oculpmWorkdayChanged
      .listen((evt) => {
        if (evt.payload.project_id !== stateRef.current?.currentProjectId) return;
        void check();
      })
      .then((fn) => {
        off = fn;
      })
      .catch(() => {});
    const onWake = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      if (off) safeUnlisten(off);
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
      setTerminalDetached,
      setActiveFile,
      setIndexing,
      setOculpmStatus,
      setCurrentSession,
    }),
    [
      state,
      setProjectMeta,
      setUiV2View,
      setTerminalDetached,
      setActiveFile,
      setIndexing,
      setOculpmStatus,
      setCurrentSession,
    ],
  );

  // ── 조각 컨텍스트 (Phase 4) — 각각 자기 키가 바뀔 때만 새 값이다.
  const runtimeSlice = useStableSlice(pickSlice(state, RUNTIME_KEYS));
  const terminalSlice = useStableSlice(pickSlice(state, TERMINAL_KEYS));
  const prefsSlice = useStableSlice(omitKeys(state, NON_PREFS_KEYS));

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => (prev.sidebarCollapsed === collapsed ? prev : { ...prev, sidebarCollapsed: collapsed }));
  }, []);
  const runtimeValue = useMemo<ProjectRuntimeValue>(
    () => ({
      ...runtimeSlice,
      setProjectMeta,
      setTerminalDetached,
      setIndexing,
      setOculpmStatus,
      setCurrentSession,
      setSidebarCollapsed,
    }),
    [runtimeSlice, setProjectMeta, setTerminalDetached, setIndexing, setOculpmStatus, setCurrentSession, setSidebarCollapsed],
  );

  const setPrefs = useCallback((updater: (prev: UiPrefsSlice) => Partial<UiPrefsSlice>) => {
    setState((prev) => {
      const patch = updater(omitKeys(prev, NON_PREFS_KEYS));
      const keys = Object.keys(patch) as (keyof UiPrefsSlice)[];
      if (keys.every((k) => Object.is(prev[k], patch[k]))) return prev;
      return { ...prev, ...patch };
    });
  }, []);
  const prefsValue = useMemo<UiPrefsValue>(
    () => ({ prefs: prefsSlice, setPrefs, setUiV2View }),
    [prefsSlice, setPrefs, setUiV2View],
  );

  const setSessions = useCallback((updater: (prev: TerminalSlice) => TerminalSlice) => {
    setState((prev) => {
      const next = updater({ terminalTabs: prev.terminalTabs, terminalActiveId: prev.terminalActiveId });
      if (next.terminalTabs === prev.terminalTabs && next.terminalActiveId === prev.terminalActiveId) return prev;
      return { ...prev, terminalTabs: next.terminalTabs, terminalActiveId: next.terminalActiveId };
    });
  }, []);
  const selectTab = useCallback(
    (id: string) => setSessions((s) => (s.terminalActiveId === id ? s : { ...s, terminalActiveId: id })),
    [setSessions],
  );
  const patchTab = useCallback(
    (id: string, fn: (tab: TerminalTab) => TerminalTab) =>
      setSessions((s) => ({ ...s, terminalTabs: s.terminalTabs.map((tab) => (tab.id === id ? fn(tab) : tab)) })),
    [setSessions],
  );
  const openTab = useCallback((tab: TerminalTab, opts?: { view?: UiV2View }) => {
    setState((prev) => ({
      ...prev,
      terminalTabs: [...prev.terminalTabs, tab],
      terminalActiveId: tab.id,
      ...(opts?.view ? { uiV2View: opts.view } : {}),
    }));
  }, []);
  const terminalValue = useMemo<TerminalSessionsValue>(
    () => ({ ...terminalSlice, setSessions, selectTab, patchTab, openTab }),
    [terminalSlice, setSessions, selectTab, patchTab, openTab],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <ProjectRuntimeContext.Provider value={runtimeValue}>
        <UiPrefsContext.Provider value={prefsValue}>
          <TerminalSessionsContext.Provider value={terminalValue}>{children}</TerminalSessionsContext.Provider>
        </UiPrefsContext.Provider>
      </ProjectRuntimeContext.Provider>
    </WorkspaceContext.Provider>
  );
}

/** 프로젝트 신원 · oculpm 상태 · 색인 중 · 분리 창 — 런타임 조각만 구독한다. */
export function useProjectRuntime(): ProjectRuntimeValue {
  const ctx = useContext(ProjectRuntimeContext);
  if (!ctx) throw new Error("useProjectRuntime must be used within a WorkspaceProvider");
  return ctx;
}

/** 영속 UI 취향(화면·필터·도크·코드 탭·acp*·…) — 취향 조각만 구독한다. */
export function useUiPrefs(): UiPrefsValue {
  const ctx = useContext(UiPrefsContext);
  if (!ctx) throw new Error("useUiPrefs must be used within a WorkspaceProvider");
  return ctx;
}

/** 터미널 세션 목록·활성 탭 — 두 창이 함께 쓰는 조각만 구독한다. */
export function useTerminalSessions(): TerminalSessionsValue {
  const ctx = useContext(TerminalSessionsContext);
  if (!ctx) throw new Error("useTerminalSessions must be used within a WorkspaceProvider");
  return ctx;
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
