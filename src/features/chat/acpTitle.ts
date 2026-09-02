// 대화 제목 — 어댑터가 주는 것을 **그대로 믿지 않는다.**
//
// 어댑터는 턴이 끝날 때마다 SDK 의 세션 요약을 읽어 제목으로 내려보내는데, 그
// 요약의 우선순위가 이렇다 (claude-agent-sdk `getSessionInfo`):
//
//     customTitle → aiTitle → **lastPrompt** → summaryHint → firstPrompt
//
// 즉 AI 가 제목을 붙이기 **전까지는 마지막으로 보낸 지시문이 곧 제목**이다.
// 그래서 대화를 이어 갈수록 상단 탭이 방금 친 말로 계속 바뀌었다 — 제목이
// 대화를 가리키지 않고 커서를 따라다녔다.
//
// 어댑터 쪽에 고칠 자리는 없다(제목을 고치는 요청이 프로토콜에 없다). 대신
// 우리는 이 대화에 **무엇을 보냈는지 알고 있다** — 받은 제목이 지시문의
// 메아리인지 가려낼 수 있다는 뜻이다. 첫 지시문의 메아리는 받아들이고(CLI 도
// 그렇게 보여 준다), 그 뒤 지시문의 메아리는 버리고 첫 지시문을 지킨다. 진짜
// 제목(aiTitle·`/rename`)은 메아리가 아니므로 그대로 이긴다.
//
// 어댑터 0.71.0 이 상류에서 이걸 고쳤다 — CLI 에 제목 생성을 따로 요청해
// **세션당 한 번만** 붙이고 래치한다. 그래도 이 걸러내기는 남긴다: 생성이
// 실패하거나 아직 못 붙은 구간에서는 어댑터가 여전히 저장된 요약(=첫 지시문)을
// 폴백으로 내려보내고, 우리가 이미 붙여 둔 제목을 지우지 않으려면 판단이
// 필요하다. 진짜 AI 제목은 메아리가 아니므로 이 함수를 그냥 통과한다.

/** 어댑터의 `sanitizeTitle` 과 같은 규칙 (claude-agent-acp 0.73.0 에서도 불변). */
const MAX_TITLE = 256;

/** 지시문 한 줄을 제목 모양으로 — 어댑터가 하는 것과 같게 접어야 비교가 선다. */
export function titleFromPrompt(text: string): string {
  const flat = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length <= MAX_TITLE ? flat : flat.slice(0, MAX_TITLE - 1) + "…";
}

/**
 * 울트라코드가 켜져 있으면 실제로 나가는 문장 앞에 키워드 한 줄이 더 붙는다
 * (ultracode.ts). 화면의 지시문에는 그 줄이 없으니, 떼고 나서 비교해야 같은
 * 말인 줄 안다 — 안 그러면 울트라코드를 켠 대화에서만 이 걸러내기가 통째로
 * 헛돈다.
 */
const KEYWORD = /^ultracode\s+/i;

/**
 * 두 제목이 같은 말인가.
 *
 * 잘린 쪽(`…`)은 **접두사까지만** 본다 — 자르는 길이는 어댑터의 것이고, 그쪽이
 * 256 을 바꾸면 우리 비교가 통째로 헛돈다. 반대로 잘리지 않았으면 정확히 같아야
 * 한다: 접두사만으로 같다고 하면 "고쳐줘" 가 "고쳐줘 그리고 …" 를 삼킨다.
 */
function sameTitle(left: string, right: string): boolean {
  const a = left.replace(KEYWORD, "");
  const b = right.replace(KEYWORD, "");
  if (a === b) return true;
  if (a.endsWith("…") && b.startsWith(a.slice(0, -1))) return true;
  if (b.endsWith("…") && a.startsWith(b.slice(0, -1))) return true;
  return false;
}

/**
 * 이 대화에 보여 줄 제목을 고른다.
 *
 * @param incoming 어댑터가 준 제목 (아직 없으면 `null`)
 * @param prompts  이 대화에 보낸 지시문들, **보낸 순서대로**
 */
export function resolveTitle(
  incoming: string | null | undefined,
  prompts: readonly string[],
): string | null {
  const title = incoming?.trim() || null;
  const first = prompts.length ? titleFromPrompt(prompts[0]) : null;
  // 무엇을 보냈는지 모르면 가려낼 방법도 없다 — 받은 것을 그대로 쓴다.
  // (창을 다시 켠 뒤 아직 열어 보지 않은 탭이 이 경우다.)
  if (!first) return title;
  if (!title) return first;
  if (sameTitle(title, first)) return first;
  const echo = prompts.slice(1).some((prompt) => sameTitle(title, titleFromPrompt(prompt)));
  return echo ? first : title;
}
