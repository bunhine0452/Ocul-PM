/**
 * 셸의 화면 이름과 그 허용 목록 — `uiV2View` 의 정본.
 *
 * `workspaceState.ts`·`workspaceDefaults.ts` 와 같은 이유로 컨텍스트에서 떼어
 * 왔다 (2026-09-06). 컨텍스트는 이미 영속화·이관·이벤트 구독을 지고 있고 파일
 * 크기 래칫에 닿아 있다 — 화면이 하나 늘 때마다 그 파일이 길어질 이유가 없다.
 *
 * 소비처는 여전히 `@/contexts/WorkspaceContext` 에서 가져온다 (재수출).
 */

/**
 * 셸의 화면 이름 (01-ia-and-shell.md §1.2). 여기 적힌 개수가 곧 화면 수이고
 * 사이드바·팔레트·⌘번호의 정본은 `lib/navRegistry.ts` 다 — 그래서 "화면 8개"
 * 같은 숫자를 주석에 적지 않는다 (2026-09-04 감사에서 세 곳이 8 에 멈춰 있었다).
 * 레거시 `activeView` 와는 별도 필드다.
 *
 * 손으로 쓴 유니온이 아니라 **런타임 배열에서 파생**한다 (2026-09-06). 예전엔
 * 타입은 여기, 허용 목록은 `ShellV2.KNOWN_VIEWS` 에 손으로 두 벌 있었고 그
 * 목록은 딥링크에만 걸려 있었다 — 영속값(`uiV2View`)은 아무 검사도 안 받았다.
 * 이제 목록이 하나뿐이라 갈라질 자리가 없고, `migrateUiV2View` 가 그 목록으로
 * 저장된 값을 거른다.
 */
export const UI_V2_VIEWS = [
  "today",
  "journal",
  "diff",
  "planner",
  "discussion",
  "retro",
  "search",
  "terminal",
  "ai",
  "graph",
  "docs",
  "skills",
  // PR-ACP6 — Claude Code 구동면. "ai"(프로바이더 채팅)와 성격이 달라 화면을
  // 나눴다: 저쪽은 물어보는 곳, 이쪽은 시키는 곳이다.
  "claudecode",
  "codex",
  // 코드 화면 (docs/code-editor/00-master-plan.md) — 인앱 코드 뷰어·에디터.
  "code",
  // 세션 (2026-09-04) — 붙어 있는 에이전트와 사용자가 묶은 팀
  // (docs/a2a/00-master-plan.md D8). Today 카드에서 화면으로 나왔다.
  "sessions",
  "settings",
] as const;

export type UiV2View = (typeof UI_V2_VIEWS)[number];

/**
 * 같은 일을 `uiV2View` 에도 한다 (2026-09-06). 이 필드는 프로젝트마다 영속되는데
 * **검증이 하나도 없었다** — 모르는 값이 들어오면 `ShellV2` 라우터의 ternary
 * 사슬이 전부 빗나가 `null` 로 끝나서 툴바도 콘텐츠도 없는 빈 본문이 남는다.
 * 화면 id 를 하나라도 없애는 순간(IA 재편) 그 화면에 머물던 사용자의 저장된
 * 값이 곧장 그 상태가 된다. 딥링크에만 걸려 있던 허용 목록을 영속값에도
 * 적용한다. Exported for unit testing.
 */
export function migrateUiV2View(raw: unknown): UiV2View {
  return (UI_V2_VIEWS as readonly string[]).includes(raw as string)
    ? (raw as UiV2View)
    : "today";
}
