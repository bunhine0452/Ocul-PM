/**
 * `WorkspaceState` — 한 프로젝트 워크스페이스의 모양 (필드 선언만).
 *
 * `workspaceDefaults.ts` 와 같은 이유로 떼어 왔다 (2026-09-04). 컨텍스트 파일은
 * 컨텍스트·영속화·이관·이벤트 구독을 한꺼번에 지고 있어서, **필드가 하나 늘 때마다
 * 그 파일이 길어질 이유가 없다.** 세션 화면이 별명 하나를 더하려다 파일 크기
 * 래칫에 걸린 것이 계기다 — 게이트가 옳았다.
 *
 * 작은 타입 별칭(`UiV2View`·`TerminalTab` …)은 컨텍스트에 남겨 두고 **타입만**
 * 가져온다. `import type` 은 런타임에 지워지므로 순환이 생기지 않는다 —
 * `workspaceDefaults.ts` 가 이미 같은 방향으로 서로를 참조한다.
 *
 * 소비처는 여전히 `@/contexts/WorkspaceContext` 에서 이 타입을 가져온다
 * (컨텍스트가 그대로 재수출한다).
 */

import type { OculpmStatus, Session } from "@/lib/bindings";
import type { PlanGroup, PlanSort } from "@/features/planner/planList";
import type { PlanView } from "@/features/planner/planMeta";
import type {
  ActiveView,
  DiffMode,
  JournalFilter,
  OculpmInitCardInfo,
  SidePanelMode,
  UiV2View,
} from "./WorkspaceContext";

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
  /**
   * 첫 기록 카드 (플랜 `first-record-loop` {#p1-states}). Today 가 이
   * 프로젝트의 일지가 **0건**인 것을 처음 본 순간 켜고, 사용자가 「확인했어요」
   * 나 닫기를 누르면 끈다. 영속: 첫 일지를 기다리다 앱을 닫아도 다음에 이어
   * 본다. 이전부터 쓰던 프로젝트는 켜진 적이 없으므로 보지 않는다.
   */
  firstRecordArmed: boolean;

  // Volatile (not persisted)

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
  /**
   * 작업 일지 열람의 서술 칸 폭 px (2026-09-11 원장의 한 장 리디자인). 왼쪽이
   * 읽는 칸, 오른쪽이 diff 라 둘의 경계는 "얼마나 긴 줄로 읽을 것인가" 의
   * 취향이고, 일지를 열 때마다 되돌아가면 안 된다. 좁은 칸에서는 CSS 가
   * 세로로 쌓으며 이 값을 무시한다.
   */
  entryReadWidth: number;
  /**
   * 계획 본문에서 완료·폐기 항목을 숨긴 상태 (2026-09-10 플래너 업그레이드).
   * 32/35 가 끝난 계획은 남은 셋을 찾으려고 취소선 벽을 스크롤하게 된다 —
   * 이 값이 켜지면 단계는 남은 항목만 펼치고 숨긴 수를 발치에 적는다.
   */
  plannerHideDone: boolean;
  /** 계획 본문의 보기 — 문서형 체크리스트 / 상태별 열 보드 (2026-09-10). */
  plannerView: PlanView;
  /** 에이전트 화면 활성 모델 id. */
  aiActiveModel: string | null;
  /**
   * 사이드바 접힘 상태 (Dogfooding 2026-06-07). true 면 사이드바가 화면에서
   * 사라지고, 좌측 가장자리 호버 시에만 오버레이로 떠오름. 영속.
   */
  sidebarCollapsed: boolean;
}
