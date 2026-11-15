// 계획의 확인 명령을 새 셸 세션에서 돌린다 (11-15 사용자 결정 「누를 때만 돌리기」, 업그레이드 라운드 X-02).
//
// 돌리는 길이 복사 → 붙여넣기 → Claude 에게 맡기기로 가장 멀었다. 이제 사람이 확인 창에서 명령 전문을 보고 누를
// 때만 앱이 그 한 줄을 돌린다. 앱은 결과를 읽지 않는다 — 계획의 통과 · 실패 줄은 여전히 Claude 가 적는다.
//
// 줄은 tty 에 쳐 넣지 않는다(`src-tauri/src/terminal_env.rs` 의 `Launch::Check`) — 환경 변수로 넘기고 셸이
// `eval` 로 그 글만 따로 읽는다. 쳐 넣으면 rc 의 질문(oh-my-zsh 업데이트 [Y/n] 등)이 첫 글자를 먹어 `pnpm test` 가
// `npm test` 로, 사람이 본 것과 다른 명령이 돌 수 있었다. 맞바꾼 것: 그 줄은 셸 기록(history)에 남지 않는다. 사람이
// 보는 자리는 확인 창의 전문과 탭 이름 「확인 명령」 이다.
//
// xterm 은 무겁다 — 계획 화면의 첫 청크에 싣지 않게 저장소를 여기서 지연 로드한다(`runPrompt.ts` 와 같다).

import { t, type I18nKey, type TVars } from "@/i18n";
import { requestTermFocus } from "./focusRequest";
import { sanitizePaste } from "./pasteSafe";

/**
 * 줄을 나누는 글자 — 정화 **앞** 원문에서 찾는다. 정화기는 CR 을 LF 로 바꾸고 NEL(U+0085)은 지워, 거른 뒤에만
 * 보면 `a⏎b` 가 `ab` 로 합쳐진 채 지나갔다. U+2028 · U+2029 는 정화기가 남기지만 화면에서는 줄을 바꾼다.
 */
const LINE_BREAK = /[\r\n\u{85}\u{2028}\u{2029}]/u;

/**
 * 확인 창에 그려지지 않거나 둘레 글자의 순서 · 자리를 바꾸는 글자 — 유니코드 서식 글자(Cf: 양방향 덮어쓰기 · 격리 ·
 * 폭 0 · BOM · 태그 …), 기본 무시 글자(변형 선택자 · 한글 채움 글자 …), ASCII 밖의 공백, 점자 빈칸.
 *
 * 확인 창은 줄을 유니코드 양방향 알고리즘대로 그린다. RLO · 격리 글자를 섞으면 창에는 `#` 뒤가 주석인 줄이 보이는데
 * 셸은 가운데 명령을 돌렸고(Trojan Source), 끊기지 않는 공백 수천 개면 뒤의 `; curl … | sh` 가 스크롤 아래로
 * 밀려났다(최종 검수 TERM-2 · SEC-01 · X-02). 정화기는 이 글자들을 지우지 않는다 — 지우면 사람이 본 줄과 다른 줄이
 * 돈다. 그래서 여기서 막는다. Rust 의 마지막 문(`terminal_env::is_invisible`)과 같은 범위다 — 사례표
 * `src-tauri/src/terminal_check_cases.json` 이 둘을 같은 사례로 문다. 결합 문자(변형 선택자 · 몽골 자유 변형 선택자 ·
 * 결합 자소 이음 …)는 둘째 칸에 따로 둔다 — 한 칸에서 앞 글자 뒤에 오면 붙은 한 글자처럼 읽혀 eslint 가 막는다.
 */
const HIDDEN =
  /[\u{A0}\u{AD}\u{600}-\u{605}\u{61C}\u{6DD}\u{70F}\u{890}\u{891}\u{8E2}\u{115F}\u{1160}\u{1680}\u{180E}\u{2000}-\u{200F}\u{202A}-\u{202F}\u{205F}-\u{206F}\u{2800}\u{3000}\u{3164}\u{FEFF}\u{FFA0}\u{FFF0}-\u{FFFB}\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]|[\u{34F}\u{17B4}\u{17B5}\u{180B}-\u{180D}\u{180F}\u{FE00}-\u{FE0F}]/u;

/** 마크다운 코드 한 덩어리로 적힌 확인 명령(`` `pnpm test` ``) — 감싼 백틱 안쪽. */
const CODE_SPAN = /^`([^`]+)`$/;

export type CheckPrep =
  | { kind: "ok"; line: string }
  | { kind: "multiline" }
  /** 보이지 않는 글자가 있다 — 이유에 그 글자들의 번호(`U+202E`)를 적는다. 사람은 편집기에서도 못 본다. */
  | { kind: "hidden"; chars: string[] }
  /** 감싼 한 쌍을 벗긴 뒤에도 백틱이 남았다 — 셸이 그 안을 먼저 명령으로 돌린다(명령 치환). */
  | { kind: "backtick" }
  /** 거르고 나니 돌릴 글자가 없다 — 단추를 세우지 않는다. */
  | { kind: "empty" };

/** 글자 하나의 번호 — `U+202E`. */
function codeOf(ch: string): string {
  return "U+" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
}

/** 보이지 않는 글자들의 번호 — 처음 나온 순서로, 같은 글자는 한 번. */
function hiddenChars(raw: string): string[] {
  const seen = new Set<string>();
  for (const ch of raw) if (HIDDEN.test(ch)) seen.add(codeOf(ch));
  return [...seen];
}

/**
 * 계획의 확인 명령 → 셸이 받을 한 줄. 확인 창에는 이 `line` 을 그대로 보인다 — 보인 글과 도는 글이 같다.
 *
 *   ① 줄바꿈이 있으면 돌리지 않는다(셸에 두 줄을 넘기면 사람이 한 줄로 읽은 것과 다른 것이 돈다).
 *   ② 보이지 않는 글자가 있으면 돌리지 않는다(`HIDDEN` — 창에 보인 순서 · 글과 셸이 읽는 것이 달라진다).
 *   ③ 제어 문자는 입력 레인의 정화기로 걷고(`pasteSafe` — CSI · OSC 는 통째로, 남은 ESC 는 보이는 ␛ 로),
 *      탭은 공백으로 바꾼다. 인자로 못 받는 셸(nushell 등)에는 이 줄을 쳐 넣는데, 거기서 탭은 자동 완성 키다.
 *   ④ 줄 전체를 감싼 백틱 한 쌍은 마크다운이라 벗긴다. 그 뒤에도 백틱이 남으면(`` `a` && `b` ``) 돌리지 않는다 —
 *      셸이 그 안을 먼저 돌리고 그 출력을 다시 명령으로 돌린다. 몰래 벗기면 계획에 적힌 것과 다른 명령이 된다.
 */
export function prepareCheck(raw: string): CheckPrep {
  if (LINE_BREAK.test(raw)) return { kind: "multiline" };
  const chars = hiddenChars(raw);
  if (chars.length > 0) return { kind: "hidden", chars };
  let line = sanitizePaste(raw).replace(/\t/g, " ").trim();
  const code = CODE_SPAN.exec(line);
  if (code) line = code[1].trim();
  if (line.includes("`")) return { kind: "backtick" };
  return line ? { kind: "ok", line } : { kind: "empty" };
}

type Tr = (key: I18nKey, vars?: TVars) => string;

/** 이유 줄에 번호로 적는 보이지 않는 글자 수 — 그 밖은 개수로 접는다. */
const NAMED = 3;

/**
 * 막힌 까닭 한 문장 — 단추 옆에 선다(`blocked`). 돌릴 수 있거나 단추가 없으면 `null`. 글자 번호는 셋까지, 나머지는
 * 「외 n개」 로(영수증 규칙 5) — 셋만 적던 때는 셋을 지운 사람이 넷째 때문에 다시 막혀도 남은 수를 알 길이 없었다.
 */
export function blockedReason(tr: Tr, prep: CheckPrep): string | null {
  if (prep.kind === "multiline") return tr("plan.check.multiline");
  if (prep.kind === "hidden") {
    const named = prep.chars.slice(0, NAMED).join(" · ");
    const more = prep.chars.length - NAMED;
    return tr("plan.check.hidden", { chars: more > 0 ? tr("plan.check.hiddenMore", { chars: named, n: more }) : named });
  }
  if (prep.kind === "backtick") return tr("plan.check.backtick");
  return null;
}

/**
 * 계획 카드에 확인 명령을 보일 때 — 보이지 않는 글자를 그 번호(`‹U+202E›`)로 드러낸다. 그대로 그리면 카드도 확인
 * 창처럼 뒤바뀐 순서로 보이고, 복사하면 그 글자들이 그대로 따라갔다.
 */
export function revealHidden(text: string): string {
  let out = "";
  for (const ch of text) out += HIDDEN.test(ch) ? `‹${codeOf(ch)}›` : ch;
  return out;
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
