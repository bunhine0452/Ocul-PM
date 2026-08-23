// 플러그인 탭(인앱 문서)의 데이터 — plugin/oculpm/ 이 SSOT 다.
//
// `description` 은 각 commands/<slug>.md 의 frontmatter description 과
// **문자 단위로 동일**해야 한다 — plugin_docs_sync.test.ts 가 강제한다
// (커맨드를 추가/수정하고 여기를 빼먹으면 게이트가 깨진다). `detail` 만
// 앱 전용 부연이다. 도구 이름 목록도 같은 테스트가 MCP 서버 소스와 대조한다.

export type PluginCommandDoc = {
  /** commands/<slug>.md 의 파일명(slug). */
  slug: string;
  /** 사용자가 입력하는 커맨드 (복사 대상). */
  cmd: string;
  /** frontmatter description 원문 — 동기 테스트 대상. */
  description: string;
  /** 앱 전용 부연 (언제·어떻게). */
  detail: string;
  /** 입력 예시. */
  example: string;
};

export const PLUGIN_INSTALL_COMMANDS = [
  "/plugin marketplace add bunhine0452/Ocul-PM",
  "/plugin install oculpm@oculpm",
] as const;

/** 권장 흐름 순서 — 랜딩 문서(oculpm.com/plugin)와 동일. */
export const PLUGIN_FLOW: readonly string[] = [
  "/oculpm:project_init",
  "/oculpm:inception",
  "/oculpm:next",
  "/oculpm:standup",
];

export const PLUGIN_COMMANDS: readonly PluginCommandDoc[] = [
  {
    slug: "project_init",
    cmd: "/oculpm:project_init",
    description:
      "이 프로젝트를 ocul-pm 추적 대상으로 초기화 (.oculpm/ + 기록 규칙 생성) — 사용자가 직접 실행하는 명시적 시작",
    detail:
      "새 저장소에서 한 번. .oculpm/(기록 저장소)·AGENTS.md(기록 규칙)·.gitignore 보호 블록이 생기고, 이미 추적 중이면 누락 구성만 보완합니다. 앱이 없어도 됩니다.",
    example: "/oculpm:project_init",
  },
  {
    slug: "inception",
    cmd: "/oculpm:inception",
    description:
      "새 프로젝트/기능 영역의 설계 시작 — 리서치→사양 확정→3-depth 계획→EVALS→rules 시드",
    detail:
      "웹 리서치로 환경을 먼저 탐색하고, 근거(버전·출처)가 실린 선택지로 사양을 확정한 뒤 3단계 상세 계획·완료 정의·초기 규칙까지 시드합니다. 아이디어를 인자로 전달할 수 있습니다.",
    example: "/oculpm:inception 할 일 앱을 만들고 싶어",
  },
  {
    slug: "next",
    cmd: "/oculpm:next",
    description:
      "활성 플랜의 다음 미완 리프를 잡아 구현 — 구현→검증→일지→플랜 갱신 한 사이클",
    detail:
      "플래너 ▶실행의 터미널 대응물. 반복 실행하면 계획이 소진될 때까지 항목 단위로 진행합니다. 특정 항목을 지정하려면 항목 id 를 인자로.",
    example: "/oculpm:next login-happy-path",
  },
  {
    slug: "standup",
    cmd: "/oculpm:standup",
    description:
      "ocul-pm 추적 프로젝트의 오늘 작업 스탠드업 — 일지·플랜 진행을 모아 요약 보고",
    detail: "한 일 / 진행 중·막힘 / 다음 형식으로 오늘을 요약합니다.",
    example: "/oculpm:standup",
  },
  {
    slug: "help",
    cmd: "/oculpm:help",
    description: "ocul-pm 플러그인 표면 전체 레퍼런스 카드 — 커맨드·MCP 도구·스킬·훅 한눈에",
    detail: "커맨드 5종·MCP 도구 5종·스킬 5종·훅 동작을 한 카드로 보여주고 다음 한 걸음을 추천합니다.",
    example: "/oculpm:help",
  },
];

export type PluginToolDoc = { name: string; desc: string };

/** MCP 도구 7종 — 이름은 동기 테스트가 서버 소스(tools.rs)와 대조한다. */
export const PLUGIN_TOOLS: readonly PluginToolDoc[] = [
  {
    name: "journal_search",
    desc: "과거 일지 검색 — 그 파일을 건드린 일지·질의·종류·기간으로. 작업 시작 전 호출이 규칙",
  },
  { name: "journal_read", desc: "검색이 고른 일지 1건의 본문 전체 — 목록 훑기용이 아님" },
  { name: "journal_write", desc: "작업 단위가 끝날 때마다 일지 1건을 규격대로 기록" },
  { name: "plan_status", desc: "활성 플랜의 항목·상태 조회 — \"지금 어디까지 됐나\"" },
  { name: "plan_update", desc: "플랜 항목 상태 갱신 + plan-log (부모는 하위 롤업 자동)" },
  { name: "plan_create", desc: "새 계획을 3단계로 생성 — frontmatter·id 규격 서버 보장" },
  { name: "project_init", desc: "미추적 저장소의 추적 시작 — 사용자 명시 확인 시에만" },
];

export type PluginHookDoc = { name: string; desc: string };

export const PLUGIN_HOOK_FEATURES: readonly PluginHookDoc[] = [
  {
    name: "플랜 컨텍스트 주입",
    desc: "세션·서브에이전트 시작 시 활성 플랜의 미완 항목 요약이 자동으로 주입됩니다 — 에이전트가 현재 계획을 알고 시작합니다.",
  },
  {
    name: "미기록 세션 신호",
    desc: "일지 없이 끝난 세션을 감지해 경고하고 Today 화면 카드로 알립니다. 사후에 일지를 쓰면 자동 해소.",
  },
  {
    name: "배달 게이트",
    desc: "이 세션에서 코드가 바뀌었는데 일지가 없으면 세션당 한 번 턴 종료를 멈추고 에이전트에게 일지 작성을 지시합니다 — 작업 중이면 안내를 무시하고 계속돼 방해가 없습니다.",
  },
  {
    name: "상태줄 배지",
    desc: "디스패치한 플랜 항목이 Claude Code 상태줄에 ⏵ OCULPM 배지로 표시됩니다 — /statusline 에서 플러그인의 hooks/oculpm-statusline.sh 를 지정해 옵인.",
  },
];

export const PLUGIN_DOCS_URL = "https://oculpm.com/plugin";
export const PLUGIN_CONTRACT_URL =
  "https://github.com/bunhine0452/Ocul-PM/blob/main/docs/claude-integration/06-plugin-contract.md";
