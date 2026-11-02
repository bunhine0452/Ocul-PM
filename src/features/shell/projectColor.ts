/**
 * 프로젝트 색 (2026-11-03) — 창을 여럿 띄워 프로젝트마다 에이전트를 돌릴 때, 윗줄 색 띠와 ⌘O 목록의
 * 점으로 어느 창인지 한눈에 가린다. 저장은 hex 가 아니라 id(`projects.color`)이고, 색은
 * `tokens.css` 의 `[data-pc="…"]` 가 테마별로 푼다. 백엔드 `PROJECT_COLORS`(commands/project.rs)와 같은 목록.
 */
export const PROJECT_COLORS = ["slate", "green", "blue", "violet", "amber", "rose", "teal", "orange"] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

/** 저장된 값이 아는 색이면 그 id, 아니면(없음 · 옛 값) `undefined` — `data-pc` 에 바로 넣는다. */
export function projectColorOf(color: string | null | undefined): ProjectColor | undefined {
  return (PROJECT_COLORS as readonly string[]).includes(color ?? "") ? (color as ProjectColor) : undefined;
}
