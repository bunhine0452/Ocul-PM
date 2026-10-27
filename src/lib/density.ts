/**
 * 화면 밀도 — 「간단 / 전문」 (best-results UI 라운드, 2026-10-28).
 *
 * 두 개의 앱이 아니다. 같은 화면에서 **달라지는 것만** 달라진다: 사이드바의
 * 도구·베타 단이 접히는가, 오늘 화면의 보조 카드가 「더 보기」로 접히는가, 일지의
 * 파일·diff 와 플래너의 로그 표가 펼쳐지는가, 단축키 힌트가 보이는가. 데이터·
 * 화면 수·단축키는 어느 쪽에서도 같다 — 숨김이 아니라 접힘이다.
 *
 * 기본은 간단: 처음 쓰는 사람과 매일 아침 3분만 쓰는 사람이 기본값이다. 전문가는
 * 토글 하나(⌘ .)로 돌아오고, 값은 SQLite 설정이라 창마다·프로젝트마다 같다.
 */
export type UiDensity = "simple" | "pro";

export const UI_DENSITY_DEFAULT: UiDensity = "simple";

/** 저장소에서 온 모르는 문자열은 기본값으로 — 읽는 쪽이 되돌린다. */
export function clampUiDensity(value: unknown): UiDensity {
  return value === "pro" ? "pro" : "simple";
}

/** 토글 한 번 = 반대쪽. 세 번째 값은 없다. */
export function toggleUiDensity(value: unknown): UiDensity {
  return clampUiDensity(value) === "pro" ? "simple" : "pro";
}

/**
 * ⌘ . 가 쏘는 창 이벤트. 단축키 훅은 설정 프로바이더를 모르므로 이벤트만 띄우고,
 * 프로바이더 안에 있는 한 곳(`DensityShortcut`)이 받아 저장한다 — 툴바마다 받으면
 * 화면 수만큼 뒤집힌다.
 */
export const DENSITY_TOGGLE_EVENT = "oculpm:toggle-density";
