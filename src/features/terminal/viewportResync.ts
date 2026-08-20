import type { Terminal } from "@xterm/xterm";

// 숨었다 다시 보인 터미널의 뷰포트 되맞춤 (2026-08-20)
//
// ── 증상 ──────────────────────────────────────────────────────────────────
// 오른쪽 도크에서 claude code 를 돌려 두고 다른 프로젝트 탭에 갔다 돌아오면,
// 대화는 계속 아래로 흘렀는데 화면이 그걸 못 따라와 잘린 채로 굳는다. ⌘J 로
// 도크를 닫았다 열면 낫는다.
//
// ── 왜 ⌘J 로는 나았나 ─────────────────────────────────────────────────────
// 도크는 조건부 렌더라 ⌘J 가 터미널을 **언마운트했다 다시 마운트**한다. xterm
// 이 통째로 새로 만들어지고 백엔드 스크롤백을 다시 재생하니 어긋남이 남을 수가
// 없다. 즉 ⌘J 는 고친 게 아니라 새로 지은 것이다.
//
// ── 진짜 원인 (xterm 5.5 `browser/Viewport.ts`) ───────────────────────────
// 비활성 탭은 `.tabpane[hidden] { display: none }` 이다. 그 동안에도 출력이
// 오면 Viewport 는 `_innerRefresh()` 를 계속 도는데,
//
//   this._lastRecordedViewportHeight = this._viewportElement.offsetHeight;
//
// 레이아웃 상자가 없는 엘리먼트의 `offsetHeight` 는 **0** 이다. 그래서
//   · 스크롤 영역 높이를 캔버스 높이만큼 짧게 잡아 캐시하고,
//   · 이어지는 `scrollTop` 대입은 조용히 무시된다(레이아웃이 없으니 늘 0).
// xterm 자신도 `_handleScroll` 에 "hidden 상태의 scrollTop 은 오염되며 버퍼를
// 맨 위로 끌어올린다"고 적어 두고 그 함수만 막아 뒀다 — `_innerRefresh` 는
// 막혀 있지 않아서, 숨어 있는 내내 어긋난 값이 캐시된다.
//
// 돌아왔을 때 크기가 그대로면 `FitAddon.fit()` 은 아무 일도 하지 않는다.
// `Terminal.resize(x, y)` 가 `x === cols && y === rows` 면 즉시 반환하기
// 때문이다. xterm 의 IntersectionObserver 는 **행 다시 그리기**만 재개할 뿐
// 스크롤 기하는 건드리지 않는다. 그래서 어긋남이 그대로 굳는다.

/**
 * `IntersectionObserver` 콜백에서 "지금 막 다시 보이게 됐는가" 를 판정한다.
 *
 * 크기 변화(`ResizeObserver`)로는 잡을 수 없는 경우가 핵심이다 — 탭을 오갔다
 * 돌아오면 **같은 크기**로 돌아오므로 리사이즈가 아예 일어나지 않는다.
 */
export function nextRevealState(
  wasVisible: boolean,
  entry: Pick<IntersectionObserverEntry, "isIntersecting" | "intersectionRatio">,
): { visible: boolean; revealed: boolean } {
  const visible =
    entry.isIntersecting === undefined ? entry.intersectionRatio > 0 : entry.isIntersecting;
  return { visible, revealed: visible && !wasVisible };
}

/** `resyncViewport` 가 실제로 쓰는 것만 추린 최소 표면 — 테스트에서 가짜를 세우기 위해. */
export type ResyncTarget = Pick<Terminal, "options" | "rows" | "refresh">;

/** xterm 기본값 (`scrollback` 이 undefined 로 보고될 때의 대비). */
const DEFAULT_SCROLLBACK = 1000;

/**
 * 뷰포트 높이·`scrollTop` 을 강제로 다시 계산시킨다.
 *
 * `scrollback` 을 1 올렸다 되돌리면 Viewport 가 `syncScrollArea()` 를 부르고,
 * 그 안의 "캐시된 뷰포트 높이 ≠ 실제 캔버스 높이" 판정이 (캐시가 0 이므로)
 * 반드시 걸려 높이와 `scrollTop` 을 다시 계산한다. 버퍼는 건드리지 않는다 —
 * 한도를 늘렸다 줄이는 사이는 동기 구간이라 새 줄이 끼어들 수 없고, 이미
 * 한도 안이던 스크롤백은 되돌릴 때도 잘리지 않는다.
 *
 * 공개 API 중 이걸 확실히 부르는 다른 길이 없다: `resize()` 는 같은 치수에서
 * 반환하고, `scrollLines(0)`·`scrollToLine(현재줄)` 은 이동량 0 이라 빠져나가며,
 * `refresh()` 는 행만 다시 그린다.
 */
export function resyncViewport(term: ResyncTarget): void {
  const scrollback = term.options.scrollback ?? DEFAULT_SCROLLBACK;
  term.options.scrollback = scrollback + 1;
  term.options.scrollback = scrollback;
  // 렌더가 멈춰 있던 동안 밀린 행을 확실히 한 번 다시 그린다.
  term.refresh(0, Math.max(0, term.rows - 1));
}
