// 손잡이를 끄는 동안 PTY 크기 통보를 붙잡아 두는 문 (2026-10-18)
//
// ── 증상 ──────────────────────────────────────────────────────────────────
// 도크·분할 손잡이로 터미널을 좁혔다 다시 넓히면, claude code 의 이전 대화가
// 좁은 폭으로 접힌 채 남는다.
//
// ── 원인 ──────────────────────────────────────────────────────────────────
// claude code 는 SIGWINCH 마다 **보이는 화면**을 새 폭으로 다시 찍는다(pty 실측:
// `ESC[H` 뒤 행마다 `ESC[2K`). 그렇게 찍힌 줄은 진짜 개행이라 스크롤백으로
// 밀려난 뒤엔 어떤 리플로로도 안 펴진다. 끄는 동안 손이 `RESIZE_SETTLE_MS` 만
// 멎어도 중간 폭이 PTY 로 새어 나갔으니, 한 번 끌 때마다 그런 줄이 쌓였다.
//
// ── 고치는 방법 ───────────────────────────────────────────────────────────
// 끄는 동안 xterm 은 그대로 맞춘다 — 리플로(soft wrap)는 넓히면 되돌아온다.
// PTY 통보만 이 문이 열려 있는 동안 미루고, 마지막 손잡이를 놓는 순간 터미널마다
// 한 번 맞춰 보낸다. 좁은 폭에 머문 채 실제로 쓰는 동안 찍힌 줄은 여전히 못
// 편다 — 그건 TUI 의 몫이다.

let active = 0;
const listeners = new Set<() => void>();

/** 제스처를 시작한다. 돌려받은 함수가 끝 — 여러 번 불러도 한 번만 끝난다. */
export function beginResizeGesture(): () => void {
  active += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active -= 1;
    if (active > 0) return;
    for (const fn of [...listeners]) fn();
  };
}

export function isResizeGestureActive(): boolean {
  return active > 0;
}

/** 마지막 제스처가 끝났을 때 부른다. 돌려받은 함수로 구독을 푼다. */
export function onResizeGestureEnd(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetResizeGestureForTest(): void {
  active = 0;
  listeners.clear();
}
