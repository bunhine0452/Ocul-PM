/**
 * 사람이 터미널에 붙여 넣는 에이전트 연결 명령 — 시작 창 「처음이라면」 3단계와
 * 설정 「에이전트 연결」이 같은 줄을 보여 준다 (한 곳에서만 고친다).
 *
 * 마켓플레이스 등록이 먼저다 — 그 줄 없이 `install` 만 치면 Claude Code 가 플러그인을
 * 어느 마켓플레이스에서 찾을지 모른다. 그래서 두 줄을 한 번에 복사한다.
 */
export const CLAUDE_PLUGIN_INSTALL = [
  "claude plugin marketplace add bunhine0452/Ocul-PM",
  "claude plugin install oculpm@oculpm",
] as const;

/** 깔린 판이 앱이 든 판보다 낮을 때. */
export const CLAUDE_PLUGIN_UPDATE = ["claude plugin update oculpm@oculpm"] as const;

export const CODEX_PLUGIN_INSTALL = [
  "codex plugin marketplace add bunhine0452/Ocul-PM",
  "codex plugin add oculpm-codex@oculpm",
] as const;
