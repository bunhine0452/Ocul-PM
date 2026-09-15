// PTY 세션 id 생성 — `TerminalSurface.tsx` 에서 옮겨 왔다 (2026-09-15 분할).
// 본체와 세션 옮기기 드래그(useSessionMove)가 함께 쓰는 순수 함수라 따로 둔다.

/**
 * PTY 세션 id. 창 소유권을 id 에 새긴다 (멀티 창 T4) — 창을 닫을 때 백엔드가
 * `p<projectId>-` 접두사로 **자기 창의 세션만** 골라 죽여 좀비 셸을 막고, 두
 * 창이 같은 8자 난수를 뽑아 한쪽 입력이 남의 셸로 가는 사고도 구조적으로
 * 불가능해진다. 접두사 규격은 `src-tauri/src/commands/window.rs::pty_prefix_for`
 * 와 짝이다 — 한쪽만 바꾸면 정리가 조용히 실패한다.
 */
export function newId(projectId: number | null): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return projectId == null ? rand : `p${projectId}-${rand}`;
}
