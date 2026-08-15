/**
 * 터미널 글자 크기의 범위와 클램프 (2026-08-15).
 *
 * 별도 모듈인 이유는 **설정 화면이 이 값을 편집하기 때문**이다. 상수를
 * `TerminalSurface` 에 두면 설정 청크가 그 파일을 타고 xterm 을 통째로 끌고
 * 온다 (터미널을 한 번도 안 여는 사용자에게 지우지 않으려던 비용이다).
 *
 * 값 자체는 앱 전역 설정(SQLite `terminal_font_size`)에 산다 — 프로젝트마다
 * 다를 이유가 없는 개인 취향이고, 도크·터미널 화면·분리 창이 같은 값을 봐야
 * 한다.
 */
export const TERM_FONT_MIN = 9;
export const TERM_FONT_MAX = 22;
export const TERM_FONT_DEFAULT = 13;

/** 글자 크기(px)를 허용 범위로 자른다 — 정수가 아닌 입력은 기본값으로. */
export function clampTermFont(px: number): number {
  if (!Number.isFinite(px)) return TERM_FONT_DEFAULT;
  return Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, Math.round(px)));
}
