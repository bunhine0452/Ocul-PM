// 파일 경로를 "목록에서 읽히는 모양" 으로 다듬는 순수 헬퍼.
//
// 좁은 사이드바(변경 diff 왼쪽 pane · 작업 일지 디테일)에 전체 경로를 한 줄로
// 넣으면 끝에서 잘려 정작 파일명이 사라진다 — `src/contexts/WorkspaceCont…`.
// 경로를 디렉터리와 파일명으로 갈라 두면, 디렉터리만 줄이고 파일명은 온전히
// 남길 수 있다. 두 화면이 같은 규칙을 쓰도록 여기 한 곳에 둔다.

/**
 * 경로 하나를 두 조각으로 — 흐린 디렉터리 + 강조된 파일명.
 * 디렉터리는 마지막 `maxSegs` 개 세그먼트만 남기고 `…/` 로 접는다: 목록이
 * 길어지면 깊은 경로의 중간은 읽히지 않으면서 폭만 먹고, 두 개의 `route.ts` 를
 * 구별해 주는 건 꼬리 쪽이다. `maxSegs = Infinity` 면 경로 전체를 유지한다
 * (파일 한 줄짜리 헤더에서 사용).
 */
export function splitPath(
  path: string,
  root = "",
  maxSegs = 2,
): { dir: string; base: string } {
  const rel = root && path.startsWith(root) ? path.slice(root.length) : path;
  const segs = rel.split("/");
  const base = segs.pop() ?? rel;
  if (segs.length === 0) return { dir: "", base };
  const kept = segs.length > maxSegs ? ["…", ...segs.slice(-maxSegs)] : segs;
  return { dir: kept.join("/") + "/", base };
}
