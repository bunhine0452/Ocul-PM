/**
 * 터미널 세션의 **정체 색** (2026-09-04).
 *
 * 에이전트를 넷 띄우면 카드 넷이 전부 같은 회색이고, 이름은 다 `claude` 다.
 * 어느 것이 무엇인지 가르는 값이 화면에 하나도 없다 — 색이 그 자리를 맡는다.
 *
 * **상태색과 겹치지 않게** 한 겹 따로 둔다. 카드의 점·아이콘·타이머는 지금도
 * 톤(실행 중·기다림·실패)을 말하고 있고, 그 위에 정체까지 얹으면 두 신호가
 * 같은 색으로 싸운다. 그래서 정체는 **왼쪽 띠와 페인 테두리**만 쓴다.
 *
 * 값은 색 이름이지 hex 가 아니다. 실제 색은 `--term-*` 토큰이 정하므로
 * 라이트/다크·프리셋 다섯 벌을 전부 따라간다 — hex 를 저장하면 다크에서 고른
 * 색이 라이트에서 안 보이게 되고, 그 순간 고른 사람이 틀린 게 된다.
 */

/**
 * 고를 수 있는 색. `--term-<이름>` 토큰이 그대로 있는 것들만 담는다.
 *
 * 초록·노랑은 뺐다. 초록은 완료(ok), 노랑은 기다림(waiting)이 이미 쓰고 있어
 * 정체 색으로 주면 "끝났나?"와 "나를 부르나?"가 매번 헷갈린다.
 */
export const SESSION_COLORS = ["blue", "magenta", "cyan", "red"] as const;

export type SessionColor = (typeof SESSION_COLORS)[number];

/** 저장된 값이 아직 우리가 아는 색인가 (옛 설정·손으로 고친 파일 방어). */
export function isSessionColor(value: unknown): value is SessionColor {
  return typeof value === "string" && (SESSION_COLORS as readonly string[]).includes(value);
}

/** 이 색을 그리는 CSS 값. 토큰을 가리키므로 테마가 바뀌면 함께 바뀐다. */
export function sessionColorVar(color: SessionColor): string {
  return `var(--term-${color})`;
}

/**
 * 요소에 얹을 인라인 스타일. 색이 없으면 `undefined` 를 돌려준다 — 빈 객체를
 * 넘기면 매 렌더 새 객체라 React 가 style 을 계속 다시 쓴다.
 *
 * 변수 이름이 `--sess` 인 이유: CSS 쪽은 `var(--sess, var(--accent))` 로 읽어
 * **안 고른 세션은 예전 그대로**가 된다 (기본값을 두 곳에 적지 않는다).
 */
export function sessionColorStyle(
  color: SessionColor | null | undefined,
): Record<string, string> | undefined {
  return isSessionColor(color) ? { "--sess": sessionColorVar(color) } : undefined;
}
