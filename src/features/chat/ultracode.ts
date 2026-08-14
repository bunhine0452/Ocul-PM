// PR-ACP10 — 울트라코드 옵트인 (순수 함수).
//
// 울트라코드는 설정 항목이 아니라 **프롬프트 키워드**다. 어댑터 소스가 그
// 사실을 명시한다 — ACP 프롬프트에 `origin: {kind: "human"}` 을 찍어 보내는
// 이유를 "the ultracode keyword opt-in honors only human-originated turns" 로
// 설명한다. 즉 우리가 보내는 턴은 이미 자격을 갖췄고, 남은 건 키워드뿐이다.
//
// 그래서 백엔드에 새 프로토콜 작업이 없다. 보내는 문장 앞에 한 단어를 붙일 뿐.

/** CLI 가 알아보는 키워드. */
const KEYWORD = "ultracode";

/** 사용자가 이미 키워드를 쳤는지 (단어 단위 — `ultracodex` 는 아니다). */
export function mentionsUltracode(text: string): boolean {
  return new RegExp(`(^|\\s)${KEYWORD}(\\s|$)`, "i").test(text);
}

/**
 * 켜져 있으면 키워드를 앞에 붙인다.
 *
 * 이미 쳐 놓았으면 **덧붙이지 않는다** — 같은 단어가 두 번 나온 프롬프트는
 * 사용자가 쓴 적 없는 문장이 되고, 전송 기록과 화면이 어긋난다.
 */
export function withUltracode(text: string, enabled: boolean): string {
  if (!enabled) return text;
  const body = text.trim();
  if (!body || mentionsUltracode(body)) return text;
  return `${KEYWORD}\n\n${body}`;
}
