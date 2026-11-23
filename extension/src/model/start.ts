// `.oculpm/` 이 없는 작업공간의 시작 안내 (love-round-20261123 L7). 패널이 비면 VS Code 가
// `package.json` 의 `viewsWelcome` 글을 띄우고, 그 안의 단추가 아래 두 줄을 클립보드에 넣는다.
// 터미널에 쳐 넣지 않는다 — 붙여 넣는 것은 사람이다. 앱의 시작 창 · 설정과 같은 줄이다
// (`src/lib/agentCommands.ts` `CLAUDE_PLUGIN_INSTALL`, `start.spec.ts` 가 문다).

export const PLUGIN_INSTALL = [
  "claude plugin marketplace add bunhine0452/Ocul-PM",
  "claude plugin install oculpm@oculpm",
] as const;

/** 클립보드에 넣을 글 — 줄마다 끝에 줄바꿈, 붙여 넣으면 두 줄이 차례로 돈다. */
export function pluginInstallText(): string {
  return PLUGIN_INSTALL.map((l) => l + "\n").join("");
}
