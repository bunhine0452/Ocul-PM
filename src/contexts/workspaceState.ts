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
import type { CodeTabsState } from "@/features/code/codeTabs";
import type { PlanGroup, PlanSort } from "@/features/planner/planList";
import type {
  ActiveView,
  DiffMode,
  DiscussionEditorMode,
  JournalFilter,
  OculpmInitCardInfo,
  SearchScope,
  SidePanelMode,
  TerminalDockPos,
  TerminalTab,
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
   * 사용자가 세션에 붙인 별명 (`agent_id` → 이름).
   *
   * 같은 프로젝트에 Claude Code 터미널 세션이 넷 붙으면 카드가 전부
   * `claude-code-term-<pid>` 라 **사람이 구별할 수가 없다.** 등록할 때 이름을
   * 준 세션은 그 이름을 쓰지만(`agent_register` 의 `name`), 대부분은 안 준다.
   *
   * 이름표는 `acpNames` 와 같은 성격이다 — 이 컴퓨터 안에서만 유효하고 원장에
   * 쓰지 않는다. 카드는 프로세스가 죽으면 사라지는 휘발성 사실이고, 거기에
   * 사용자의 말을 섞으면 지워도 되는지 아무도 모르게 된다.
   */
  sessionAliases: Record<string, string>;
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
