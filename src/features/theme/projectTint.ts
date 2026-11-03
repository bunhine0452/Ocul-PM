/**
 * 프로젝트 색이 창 전체 바탕에 옅게 스민다 (2026-11-03).
 *
 * 강조색(`projectAccent.ts`)만으로는 버튼 · 고른 탭에만 색이 섰다 — 창을 나란히 세웠을 때 면적의 대부분인
 * 바탕(목록 · 본문 · 터미널)은 세 창이 똑같았다. 그래서 바탕 세 단(창 · 목록 칸 · 본문)에 프로젝트 색을 몇 % 섞는다.
 *
 * **CSS `color-mix()` 가 아니라 여기서 hex 로 섞는 이유:** 터미널(xterm)은 `--term-bg`(= `--bg-content`)를
 * `getComputedStyle` 로 읽어 색 문자열로 쓴다. 사용자 정의 속성의 계산값은 `color-mix(…)` 글자 그대로라
 * xterm 이 읽지 못한다. 섞은 hex 를 `<html>` 의 인라인 속성으로 얹으면 `var()` 를 거치는 모든 곳 — 터미널
 * 포함 — 이 같은 색을 받는다.
 *
 * 섞는 양은 바탕을 알아볼 만큼만이다. 글자 대비는 거의 그대로다(`design_tokens.test.ts` 가 바탕값에서 잰다).
 */

import type { ProjectColor } from "@/features/shell/projectColor";

/** 프로젝트 색 hex — `tokens.css` 의 밝은 `[data-pc]` 와 같은 값(`vscode_color.rs` 도 같다). */
export const PROJECT_HEX: Record<ProjectColor, string> = {
  slate: "#6b7280",
  green: "#12a06b",
  blue: "#2f7fd8",
  violet: "#7c5cd6",
  amber: "#c2891b",
  rose: "#d05470",
  teal: "#0f9a99",
  orange: "#d2703a",
};

/**
 * 물드는 바탕 — 창 · 목록 칸 · 본문 셋. **카드(`--bg-card`)와 입력칸 · 코드 칸(`--bg-inset`)은 물들이지
 * 않는다** (화면 검사 11-03): 다섯 단을 다 섞었더니 카드와 그 아래 바탕이 같은 색조로 붙어 카드의 테가
 * 사라지고, 따뜻한 회색 입력칸에 푸른 기가 섞여 탁해졌다. 바탕만 물들고 카드가 그 위에 깨끗하게 떠야
 * 「이 창은 이 프로젝트」와 「여기가 읽을 곳」이 같이 읽힌다.
 */
export const TINTED = ["--bg-window", "--bg-sidebar", "--bg-content"] as const;

/** 예전에 물들이던 것 — 걷을 때 같이 걷는다(이 판 이전에 얹힌 값이 남지 않게). */
const ALL_TINTED = [...TINTED, "--bg-card", "--bg-inset"] as const;

/** 섞는 양 — 어두운 바탕은 같은 %로도 덜 보여 조금 더. */
const AMOUNT = { light: 0.045, dark: 0.07 } as const;

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `amount` 만큼 `tint` 를 `base` 에 섞는다 (sRGB 선형 보간). 읽을 수 없는 값이면 `null`. */
export function mixHex(tint: string, base: string, amount: number): string | null {
  const a = parseHex(tint);
  const b = parseHex(base);
  if (!a || !b) return null;
  const ch = (i: number) => Math.round(b[i] + (a[i] - b[i]) * amount);
  return "#" + [0, 1, 2].map((i) => ch(i).toString(16).padStart(2, "0")).join("");
}

/**
 * `<html>` 의 바탕을 프로젝트 색으로 물들이거나(색 있음) 걷는다(색 없음). 테마(밝게 · 어둡게)가 바뀔 때도
 * 다시 부른다 — 바탕값을 매번 스타일시트에서 새로 읽는다.
 */
export function applyProjectTint(
  root: HTMLElement,
  color: ProjectColor | undefined,
  family: "light" | "dark",
): void {
  for (const key of ALL_TINTED) root.style.removeProperty(key);
  if (!color) {
    root.removeAttribute("data-tint");
    return;
  }
  const style = getComputedStyle(root);
  for (const key of TINTED) {
    const mixed = mixHex(PROJECT_HEX[color], style.getPropertyValue(key), AMOUNT[family]);
    if (mixed) root.style.setProperty(key, mixed);
  }
  // 터미널이 이 속성의 변화를 보고 팔레트를 다시 읽는다(`termTheme.ts`). 바탕을 얹은 **뒤에** 단다.
  root.setAttribute("data-tint", color);
}
