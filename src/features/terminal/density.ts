/**
 * 터미널 **밀도 프리셋** (2026-08-28 시각 정체성 라운드).
 *
 * 글자 크기와 밀도는 다른 축이다 — 크기는 "읽히는가", 밀도는 "숨 쉴 자리가
 * 있는가". 에이전트를 붙여 놓고 몇 시간씩 쳐다보는 화면에서는 줄 간격 0.25 가
 * 피로도를 크게 바꾸는데, 글자만 키우면 한 화면에 들어가는 줄만 줄어든다.
 *
 * `fontSize.ts` 와 같은 이유로 별도 모듈이다: 상수를 `TerminalSurface` 에 두면
 * 이 값을 읽는 쪽이 xterm 을 통째로 끌고 온다.
 *
 * 값은 앱 전역 설정(SQLite `terminal_density`)에 산다 — 도크·터미널 화면·분리
 * 창이 같은 값을 봐야 하고, 프로젝트마다 다를 이유가 없는 개인 취향이다.
 */
import type { I18nKey } from "@/i18n";

export type TermDensity = "comfortable" | "standard" | "compact";

export const TERM_DENSITY_DEFAULT: TermDensity = "standard";

/** 화면에 그릴 순서 — 넉넉함 → 조밀함. */
export const TERM_DENSITIES: readonly TermDensity[] = ["comfortable", "standard", "compact"];

/**
 * xterm `lineHeight` (글자 크기 배수).
 *
 * 1.0 미만으로는 내려가지 않는다 — 글리프가 셀 밖으로 새면 위아래 줄의 한글
 * 받침과 밑줄이 잘린다. `compact` 의 1.05 가 안전한 하한이다.
 */
const LINE_HEIGHT: Record<TermDensity, number> = {
  comfortable: 1.5,
  standard: 1.25,
  compact: 1.05,
};

/** 페인 안쪽 여백(px) — CSS 변수 `--term-pane-pad` 로 나간다. */
const PANE_PAD: Record<TermDensity, number> = {
  comfortable: 14,
  standard: 9,
  compact: 5,
};

/** 상태바·레일 라벨. */
export const TERM_DENSITY_LABEL: Record<TermDensity, I18nKey> = {
  comfortable: "term.density.comfortable",
  standard: "term.density.standard",
  compact: "term.density.compact",
};

const KNOWN = new Set<string>(TERM_DENSITIES);

/** 설정에서 읽은 문자열을 프리셋으로. 모르는 값은 기본값으로 되돌린다. */
export function clampTermDensity(raw: string | null | undefined): TermDensity {
  return raw && KNOWN.has(raw) ? (raw as TermDensity) : TERM_DENSITY_DEFAULT;
}

export function termLineHeight(density: TermDensity): number {
  return LINE_HEIGHT[density];
}

export function termPanePad(density: TermDensity): number {
  return PANE_PAD[density];
}
