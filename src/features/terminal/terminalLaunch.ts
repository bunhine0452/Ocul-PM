// 터미널에서 CLI 에이전트를 띄우는 길.
//
// **왜 두 길인가.** 우리 본진은 ACP 다 — 그래야 도구 카드·권한 승인·대화별
// 기록 같은 것이 데이터로 온다. 하지만 어댑터는 CLI 가 가진 것 중 **자기가
// 노출하기로 한 것만** 준다. `/remote-control`·`/login` 처럼 CLI 의 대화형
// UI 에 사는 기능은 그 통로로 못 닿는다.
//
// 터미널은 그 반대다: 구조는 하나도 없지만 **CLI 가 가진 전부**가 그대로 된다.
// (Orca 가 이 길만으로 37개 에이전트를 지원한다 — `launchCmd: 'claude'` 를
// node-pty 에 태우고 TUI 를 렌더한다.)
//
// 그래서 갈아타지 않고 하나 더 둔다. 구조가 필요한 일은 ACP 로, 터미널이
// 필요한 일은 터미널로.

/**
 * PTY 세션 id.
 *
 * `p<projectId>-` 접두사는 규격이다 — 창을 닫을 때 백엔드가 이 접두사로 자기
 * 창의 세션만 골라 죽인다 (`src-tauri/src/commands/window.rs::pty_prefix_for`).
 *
 * **주의**: 지금 `TerminalScreenV2` 안에 같은 함수(`newId`)가 따로 있다. 그쪽을
 * 이 모듈로 모으는 것이 맞지만, 그 파일은 지금 다른 작업이 잡고 있어 손대지
 * 않았다. 접두사 규격을 바꾸게 되면 **세 곳**(여기·저기·Rust)을 함께 고쳐야
 * 한다.
 */
export function newPtySessionId(projectId: number | null): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return projectId == null ? rand : `p${projectId}-${rand}`;
}

/**
 * 새 셸이 뜨자마자 한 번 칠 명령.
 *
 * 탭 정보가 아니라 **일회용 등록소**에 둔다. 탭에 얹어 영속화하면 그 탭을 다시
 * 열 때마다 `claude` 가 또 뜬다 — 사용자는 셸을 이어 쓰려고 돌아온 것이다.
 */
const bootCommands = new Map<string, string>();

export function stageBootCommand(sessionId: string, command: string): void {
  bootCommands.set(sessionId, command);
}

/** 꺼내면서 지운다 — 재접속 때 다시 실행되지 않도록. */
export function takeBootCommand(sessionId: string): string | null {
  const command = bootCommands.get(sessionId) ?? null;
  bootCommands.delete(sessionId);
  return command;
}

/**
 * 홑따옴표로 감싼다 (POSIX 셸).
 *
 * 프롬프트에는 사용자가 쓴 아무 글자나 들어온다 — 감싸지 않으면 백틱·`$`·`;`
 * 하나에 엉뚱한 명령이 실행된다. 홑따옴표 안에서는 홑따옴표 자신만 탈출하면
 * 되고, 그 관용구가 `'\''` 다.
 */
export function shellQuote(text: string): string {
  // 정규식(따옴표를 품은 리터럴)도 `replaceAll`(tsconfig 의 lib 보다 최신)도
  // 못 쓴다 — 앞의 것은 lint 의 주석 스트리퍼를 헷갈리게 하고, 뒤의 것은
  // 타입이 없다. 쪼개고 잇는 편이 둘 다 피하면서 뜻도 분명하다.
  const ESCAPED = "'" + String.fromCharCode(92) + "''";
  return "'" + text.split("'").join(ESCAPED) + "'";
}

/**
 * 터미널에서 Claude Code 를 띄우는 명령줄.
 *
 * `--prefill` 은 입력만 채우고 **보내지는 않는다** — 사람이 읽고 고친 뒤 엔터를
 * 치게 하는 것이 이 길의 요점이다(Orca 가 붙여넣기 경합을 피하려고 쓰는 것과
 * 같은 플래그).
 */
export function claudeCommand(prefill?: string | null): string {
  const text = prefill?.trim();
  return text ? `claude --prefill ${shellQuote(text)}` : "claude";
}
