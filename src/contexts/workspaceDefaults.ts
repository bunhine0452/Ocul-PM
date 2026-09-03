/**
 * `WorkspaceState` 의 초기값 — 한 프로젝트를 처음 열었을 때의 워크스페이스.
 *
 * `WorkspaceContext` 에서 그대로 떼어 왔다 (2026-09-03). 그 파일은 컨텍스트·
 * 영속화·이관을 한꺼번에 지고 1500줄을 넘겼는데, 이 목록은 그중 유일하게
 * 로직이 없는 부분이라 필드가 하나 늘 때마다 파일이 길어질 이유가 없다.
 *
 * 컨텍스트에서 **타입만** 가져온다 (`import type` 은 런타임에 지워진다).
 * 스키마 버전이 이쪽으로 따라온 것도 그래서다 — 값을 되가져오면 두 모듈이
 * 서로를 실행 시점에 기다리게 되고, 초기화 순서에 따라 TDZ 로 터진다.
 */

import type { WorkspaceState } from "./WorkspaceContext";

export const WORKSPACE_SCHEMA_VERSION = 4;

export const DEFAULT_STATE: WorkspaceState = {
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
  oculpmInitCard: null,
  indexingProjectId: null,
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
  plannerRailWidth: 236,
  plannerRailSide: "left",
  searchScope: "semantic",
  searchRecent: [],
  terminalTabs: [],
  terminalActiveId: null,
  terminalDockOpen: false,
  terminalDockPos: "bottom",
  terminalDockHeight: 300,
  terminalDockWidth: 460,
  terminalDetached: false,
  aiActiveModel: null,
  acpPanelOpen: true,
  acpTabs: [],
  acpNames: {},
  acpLastSession: null,
  codexAcpTabs: [],
  codexAcpNames: {},
  sessionAliases: {},
  codexAcpLastSession: null,
  acpUltracode: false,
  aiThreadId: null,
  docsActivePath: null,
  codeActivePath: null,
  codeTabs: null,
  codePanelHeight: 240,
  codeSidebarSide: "left",
  codeSearchOpts: { caseSensitive: false, wholeWord: false, regex: false },
  discussionActiveId: null,
  discussionEditorMode: "split",
  sidebarCollapsed: false,
};
