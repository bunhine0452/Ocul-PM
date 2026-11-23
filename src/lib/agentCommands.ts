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

/**
 * 마켓플레이스는 이미 있고 이 프로젝트에만 설치가 없을 때(마켓만 더함 · 다른 프로젝트에만 깔림) — 사용자
 * 스코프로 깔아 어느 프로젝트에서든 붙게 한다. 프로젝트마다 깔린 판은 그대로 그 프로젝트가 이긴다.
 */
export const CLAUDE_PLUGIN_INSTALL_HERE = ["claude plugin install oculpm@oculpm"] as const;

/** 깔았지만 `enabledPlugins` 에서 꺼 두었을 때 — 스코프는 Claude 가 이 폴더에서 찾는다. */
export const CLAUDE_PLUGIN_ENABLE = ["claude plugin enable oculpm@oculpm"] as const;

export const CODEX_PLUGIN_INSTALL = [
  "codex plugin marketplace add bunhine0452/Ocul-PM",
  "codex plugin add oculpm-codex@oculpm",
] as const;
