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

/**
 * 설정 「표시」의 베타 화면 스위치가 다루는 뷰 — 보류 등급 다섯 화면 (docs/PROMISE.md).
 * 끄면 사이드바 베타 단에서 그 행이 접힌다. 화면·단축키·⌘K 는 그대로다.
 */
export const HOLD_SWITCH_VIEWS = ["terminal", "code", "claudecode", "codex", "ai"] as const;
export type HoldSwitchView = (typeof HOLD_SWITCH_VIEWS)[number];

/** 설정 문자열(쉼표 구분) → 접힌 뷰 집합. 모르는 id 는 버린다. */
export function parseHiddenViews(raw: unknown): Set<HoldSwitchView> {
  const out = new Set<HoldSwitchView>();
  if (typeof raw !== "string" || !raw) return out;
  for (const part of raw.split(",")) {
    const id = part.trim() as HoldSwitchView;
    if ((HOLD_SWITCH_VIEWS as readonly string[]).includes(id)) out.add(id);
  }
  return out;
}

/** 스위치 하나를 뒤집은 설정 문자열. 순서는 `HOLD_SWITCH_VIEWS` 그대로라 비교가 안정적이다. */
export function toggleHiddenView(raw: unknown, id: HoldSwitchView): string {
  const set = parseHiddenViews(raw);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return HOLD_SWITCH_VIEWS.filter((v) => set.has(v)).join(",");
}
