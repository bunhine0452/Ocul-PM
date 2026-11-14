// 계획의 확인 명령을 새 셸 세션에서 돌린다 (11-15 사용자 결정 「누를 때만 돌리기」, 업그레이드 라운드 X-02).
//
// 돌리는 길이 복사 → 붙여넣기 → Claude 에게 맡기기로 가장 멀었다. 이제 사람이 확인 창에서 명령 전문을 보고 누를
// 때만 앱이 그 한 줄을 돌린다. 앱은 결과를 읽지 않는다 — 계획의 통과 · 실패 줄은 여전히 Claude 가 적는다.
//
// 줄은 tty 에 쳐 넣지 않고 셸의 명령 인자로 넘긴다(`src-tauri/src/terminal_env.rs` 의 `Launch::Check`). 쳐 넣으면
// rc 의 질문(oh-my-zsh 업데이트 [Y/n] 등)이 첫 글자를 먹어 `pnpm test` 가 `npm test` 로, 사람이 본 것과 다른 명령이
// 돌 수 있었다 — 「다음」 줄이 그래서 인자로 옮겼다. 맞바꾼 것: 그 줄은 셸 기록(history)에 남지 않는다. 사람이 보는
// 자리는 확인 창의 전문과 탭 이름 「확인 명령」 이다.
//
// xterm 은 무겁다 — 계획 화면의 첫 청크에 싣지 않게 저장소를 여기서 지연 로드한다(`runPrompt.ts` 와 같다).

import { t } from "@/i18n";
import { requestTermFocus } from "./focusRequest";
import { sanitizePaste } from "./pasteSafe";

/**
 * 줄을 나누는 글자 — 정화 **앞** 원문에서 찾는다. 정화기는 CR 을 LF 로 바꾸고 NEL(U+0085)은 지워, 거른 뒤에만
 * 보면 `a⏎b` 가 `ab` 로 합쳐진 채 지나갔다. U+2028 · U+2029 는 정화기가 남기지만 화면에서는 줄을 바꾼다.
 */
const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/;

/** 마크다운 코드 한 덩어리로 적힌 확인 명령(`` `pnpm test` ``) — 감싼 백틱 안쪽. */
const CODE_SPAN = /^`([^`]+)`$/;

export type CheckPrep =
  | { kind: "ok"; line: string }
  | { kind: "multiline" }
  /** 거르고 나니 돌릴 글자가 없다 — 단추를 세우지 않는다. */
  | { kind: "empty" };

/**
 * 계획의 확인 명령 → 셸이 받을 한 줄. 확인 창에는 이 `line` 을 그대로 보인다 — 보인 글과 도는 글이 같다.
 *
 *   ① 줄바꿈이 있으면 돌리지 않는다(셸에 두 줄을 넘기면 사람이 한 줄로 읽은 것과 다른 것이 돈다).
 *   ② 제어 문자는 입력 레인의 정화기로 걷고(`pasteSafe` — CSI · OSC 는 통째로, 남은 ESC 는 보이는 ␛ 로),
 *      탭은 공백으로 바꾼다. 인자로 못 받는 셸(nushell 등)에는 이 줄을 쳐 넣는데, 거기서 탭은 자동 완성 키다.
 *   ③ 줄 전체를 감싼 백틱 한 쌍은 벗긴다. 그대로 셸에 주면 명령 치환이 되어 명령의 출력을 다시 명령으로 돌린다.
 */
export function prepareCheck(raw: string): CheckPrep {
  if (LINE_BREAK.test(raw)) return { kind: "multiline" };
  let line = sanitizePaste(raw).replace(/\t/g, " ").trim();
  const code = CODE_SPAN.exec(line);
  if (code) line = code[1].trim();
  return line ? { kind: "ok", line } : { kind: "empty" };
}

/**
 * 확인 창에서 누른 한 줄을 프로젝트 폴더의 새 셸 세션에서 돌리고, 터미널 화면으로 옮겨 그 세션을 고른다
 * (`requestTermFocus` — 셸이 화면을 옮기고 터미널 화면이 그 세션을 고른다). 돌려주는 것은 세션 id.
 */
export async function runCheckInTerminal(projectId: number, line: string): Promise<number> {
  const { openTerm } = await import("./termStore");
  const id = await openTerm(projectId, null, null, false, { line, label: t("plan.check.session") });
  requestTermFocus(id);
  return id;
}
