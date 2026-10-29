/**
 * 「다음」 실행(`claude "<prompt>"`) 뒤 셸이 claude 를 못 찾았는가 (ocul-next #launch-fail,
 * Orca `agent-turn-idle-verdict` 참고). 못 찾았으면 셸만 남은 세션이다 — 「실행 중」으로 세지
 * 않는 것은 이미 된다(포그라운드가 셸이라 `busy` 가 거짓). 여기는 **알려 주는** 몫이다.
 *
 * 셸마다 말이 다르다. 세션 첫머리만 본다 — 그 뒤의 같은 글자는 claude 가 띄운 내용일 수 있다.
 */
const NOT_FOUND: readonly RegExp[] = [
  /command not found: claude\b/, // zsh
  /\bclaude: command not found/, // bash
  /\bclaude: not found/, // dash · sh
  /Unknown command: claude\b/, // fish
  /'claude' is not recognized/, // PowerShell · cmd
];

/** 세션 첫머리로 볼 만큼 — 셸 프롬프트 · 프로필 출력까지 넉넉히. */
export const LAUNCH_WATCH_CHARS = 4096;

export function launchFailed(head: string): boolean {
  return NOT_FOUND.some((re) => re.test(head));
}
