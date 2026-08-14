// PR-ACP5 — `@` 파일 멘션의 텍스트 조작 (순수 함수).
//
// 컴포넌트에서 떼어낸 이유: "어디부터 어디까지가 멘션인가"는 눈으로 검증하기
// 어렵고 조용히 틀린다. 이메일 주소(`a@b.com`)를 멘션으로 오인하거나, 고른 뒤
// 앞 문장을 함께 지워 버리는 식이다.

/** 입력 끝에 걸려 있는 `@질의`. 없으면 `null`. */
export interface MentionQuery {
  /** `@` 뒤의 글자들 (빈 문자열이면 방금 `@` 를 친 상태). */
  query: string;
  /** `@` 의 인덱스 — 치환 시작점. */
  start: number;
}

/**
 * 커서(=입력 끝) 앞의 멘션을 찾는다.
 *
 * `@` 는 **줄 첫머리이거나 공백 뒤**여야 한다 — 그래야 `user@example.com` 이
 * 멘션으로 잡히지 않는다. 질의에 공백은 들어갈 수 없다(파일 경로에 공백이 있어도
 * 멘션 중에는 끊긴다 — 목록에서 고르면 되므로 실사용에 문제가 없다).
 */
export function findMentionQuery(text: string): MentionQuery | null {
  const match = /(?:^|\s)@(\S*)$/.exec(text);
  if (!match) return null;
  return {
    query: match[1],
    // match.index 는 앞 공백을 포함하므로 `@` 위치를 다시 계산한다.
    start: match.index + match[0].length - match[1].length - 1,
  };
}

/** 멘션을 고른 결과 텍스트 (뒤에 공백 한 칸을 붙여 다음 입력을 잇게 한다). */
export function applyMention(text: string, mention: MentionQuery, relPath: string): string {
  return `${text.slice(0, mention.start)}@${relPath} `;
}
