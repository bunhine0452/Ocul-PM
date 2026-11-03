/**
 * 프로젝트 색 → 이 창의 강조색 (2026-11-03).
 *
 * 창 하나 = 프로젝트 하나라, 프로젝트에 색을 정했으면 그 창의 강조색(주 버튼 · 고른 탭 · 포커스 테)도
 * 그 색이 된다 — 창 여럿을 나란히 세웠을 때 윗줄 띠만이 아니라 창 전체가 어느 프로젝트인지 말한다.
 * 색이 없으면 설정의 강조색 그대로다. 「프로젝트별 테마」(4.0 에서 걷은 팔레트 파일)를 되살린 것이
 * 아니라 이미 있는 강조색 팔레트를 고르는 것뿐이다.
 *
 * 셸(`TopBar`)이 이 창의 프로젝트 색을 [`projectAccent`] 에 넣고, `SettingsContext` 가 테마를 얹을 때
 * [`accentFor`] 로 설정의 강조색보다 앞세운다.
 */

import { createStore } from "@/lib/createStore";
import type { ProjectColor } from "@/features/shell/projectColor";

/** 프로젝트 색 id → `data-accent` 팔레트 (`tokens.css`). 이름이 다른 것만 바꾼다. */
const ACCENT_OF: Record<ProjectColor, string> = {
  slate: "slate",
  green: "green",
  blue: "blue",
  violet: "purple",
  amber: "amber",
  rose: "rose",
  teal: "teal",
  orange: "orange",
};

/** 이 창의 프로젝트 색 — 없으면 `undefined`. */
export const projectAccent = createStore<ProjectColor | undefined>(undefined);

/** 프로젝트 색이 있으면 그 팔레트, 없으면 설정의 강조색. */
export function accentFor(projectColor: ProjectColor | undefined, settingAccent: string): string {
  return projectColor ? ACCENT_OF[projectColor] : settingAccent;
}
