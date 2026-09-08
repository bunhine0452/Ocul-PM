// PTY 크기 통보의 직렬화·합치기 (2026-09-01)
//
// ── 증상 ──────────────────────────────────────────────────────────────────
// 터미널 페인을 줄였다 키우면 글자가 깨진다. claude code 를 띄워 둔 페인에서는
// 같은 출력이 두 번 찍히고, 위로 스크롤하면 그 깨진 줄들이 그대로 남아 있다.
//
// ── 원인 ──────────────────────────────────────────────────────────────────
// 분할 막대를 끌면 `pointermove` 마다 페인 비율이 바뀌고 `ResizeObserver` 가
// 프레임마다 깨어난다. 그때마다 `fit()` 이 새 cols/rows 를 내놓고, 종전 코드는
// 그 값을 **fire-and-forget** 으로 `resize_pty` 에 던졌다:
//
//   void commands.resizePty(sessionId, term.rows, term.cols)   // ← 순서 없음
//
// tauri 커맨드는 하나하나가 별도 tokio 태스크다. 20 번을 연달아 던지면 호스트
// 소켓에 닿는 순서는 보장되지 않는다 — 마지막에 도착한 것이 **중간 크기**일 수
// 있고, 그러면 PTY 는 그 중간 크기로 굳는다.
//
// PTY 폭이 xterm 폭과 어긋나면 전부 무너진다. claude code 처럼 커서를 위로
// 올려 자기 화면을 다시 그리는 TUI 는 `process.stdout.columns` 로 줄 수를
// 계산하는데, 실제 화면은 다른 폭으로 접히니 지운다고 믿은 줄이 안 지워진다 —
// **같은 텍스트가 두 번 보이는** 것이 이것이고, 그 잔해가 스크롤백에 그대로
// 쌓이니 위로 올려도 깨진 채로 보인다.
//
// ── 고치는 방법 ───────────────────────────────────────────────────────────
// 한 번에 하나만 보내고(직렬화), 보내는 동안 쌓인 것은 **마지막 하나로 접는다**
// (합치기). 그러면 중간 크기는 건너뛰거나 곧바로 최종 크기로 덮이고, 마지막에
// 도착하는 것은 언제나 사용자가 손을 뗀 그 크기다.

/** 실제 전송 — 실패는 거부된 프라미스로 알린다 (`commands.resizePty` 그대로). */
export type ResizeSender = (rows: number, cols: number) => Promise<unknown>;

export interface PtySize {
  rows: number;
  cols: number;
}

export interface PtyResizeQueue {
  /** 희망 크기를 적는다. 마지막에 적힌 것만 살아남는다. */
  push(rows: number, cols: number): void;
  /**
   * 중복 판정을 지운다 — 세션을 새로 띄우거나 다시 붙인 직후에 부른다.
   * 큐는 "이미 보낸 크기"를 기억해 같은 값을 다시 보내지 않는데, PTY 가 바뀌면
   * 그 기억은 남의 것이다.
   */
  reset(): void;
  /** 이후의 전송을 막는다 (언마운트). 날아간 요청은 그대로 끝난다. */
  dispose(): void;
  /** 마지막으로 전송을 **시작한** 크기 — 테스트·진단용. */
  readonly lastSent: PtySize | null;
}

/**
 * 세션 하나의 resize 통보 큐.
 *
 * - 한 번에 한 요청만 날아간다. 응답(성공이든 실패든)이 와야 다음이 나간다.
 * - 그 사이 들어온 `push` 는 마지막 하나만 남는다.
 * - 직전에 보낸 것과 같은 크기는 보내지 않는다 — SIGWINCH 한 번이 전체화면
 *   TUI 에게는 화면 전체 다시 그리기라, 의미 없는 통보는 그 자체로 깜빡임이다.
 * - 전송이 실패하면 "보낸 크기" 기억을 지운다. 같은 크기가 다시 밀려오면 그때
 *   한 번 더 시도한다 (여기서 스스로 재시도 루프를 돌지는 않는다 — 죽은
 *   호스트를 상대로 무한히 두드릴 이유가 없다).
 */
export function createPtyResizeQueue(send: ResizeSender): PtyResizeQueue {
  let desired: PtySize | null = null;
  let sent: PtySize | null = null;
  let inFlight = false;
  let disposed = false;

  const pump = (): void => {
    if (inFlight || disposed) return;
    const next = desired;
    desired = null;
    if (!next) return;
    if (sent && sent.rows === next.rows && sent.cols === next.cols) return;

    inFlight = true;
    sent = next;
    const settle = () => {
      inFlight = false;
      pump();
    };
    let promise: Promise<unknown>;
    try {
      promise = send(next.rows, next.cols);
    } catch {
      // 동기로 던지는 sender 도 큐를 멈추지 못하게 한다.
      sent = null;
      settle();
      return;
    }
    void Promise.resolve(promise).then(settle, () => {
      sent = null;
      settle();
    });
  };

  return {
    push(rows, cols) {
      if (disposed) return;
      // fit() 이 렌더러가 준비되기 전 값을 내놓는 구간이 있다 — 0 이하는 PTY
      // 에게 의미가 없고, 셸이 그 크기로 화면을 지워 버린다.
      if (!Number.isFinite(rows) || !Number.isFinite(cols)) return;
      if (rows <= 0 || cols <= 0) return;
      desired = { rows, cols };
      pump();
    },
    reset() {
      sent = null;
    },
    dispose() {
      disposed = true;
      desired = null;
    },
    get lastSent() {
      return sent;
    },
  };
}

// ── 폭 이어받기 ───────────────────────────────────────────────────────────
//
// ── 증상 ──────────────────────────────────────────────────────────────────
// claude code 를 띄워 둔 세션을 ⌘J 도크와 터미널 화면 사이에서 오가면, 그때까지
// 쌓인 대화가 좁은 폭으로 접힌 채 **영영 굳는다**. 화면을 다시 넓혀도 옛 줄은
// 좁은 그대로다.
//
// ── 왜 되돌릴 수 없나 ─────────────────────────────────────────────────────
// 셸이 그냥 뱉은 긴 줄은 xterm 이 접은 것이라(soft wrap) 폭이 바뀌면 xterm 이
// 다시 편다. 그런데 claude code 같은 TUI 는 자기가 `stdout.columns` 를 읽어
// **직접 개행을 넣어** 뱉는다. 그렇게 들어간 개행은 스크롤백 안에서는 그냥
// 줄바꿈 문자라, 어떤 리플로도 지울 수 없다. 즉 좁은 폭으로 한 번 찍힌 텍스트를
// 나중에 되살리는 길은 없다 — 애초에 폭을 흔들지 않는 것이 유일한 수단이다.
//
// ── 어디서 흔들리나 ───────────────────────────────────────────────────────
// 도크와 터미널 화면은 **같은 세션**을 그리는데 크롬이 다르다 (도크는 compact
// 레일 168px·좁은 여백, 화면은 200px·넓은 여백). 그래서 자리를 옮기기만 해도
// 열 수가 몇 칸 달라지고, 그 몇 칸이 매번 대화를 한 번씩 접는다.
//
// ── 규칙 ──────────────────────────────────────────────────────────────────
// 붙는 순간에는 **세션이 쓰던 폭을 그대로 이어받는다** — 들어갈 자리가 있고,
// 남는 띠가 눈에 띄지 않을 만큼만 차이 날 때. 사람이 폭을 실제로 바꾸면
// (창 크기·도크 손잡이·분할·글자 크기) 그 순간 놓아 주고 평소대로 맞춘다.

/** 남는 오른쪽 띠의 한도(열). 이보다 크게 벌어지면 그냥 새로 맞춘다. */
export const ADOPT_SLACK_COLS = 12;

/** 이어받는 중인 폭 — 판정이 참조하는 최소 상태. */
export interface AdoptedWidth {
  /** 붙었을 때 세션이 쓰고 있던 열 수. */
  cols: number;
  /** 그때의 컨테이너 폭(px). 이 값이 달라지면 사람이 폭을 바꾼 것이다. */
  atWidth: number;
}

/**
 * 이번 fit 에서 세션의 폭을 이어받을지 판정한다.
 *
 * @param adopt  이어받는 중인 폭 (없으면 `null`)
 * @param fitted 이 페인에 실제로 들어가는 열 수
 * @param width  지금 컨테이너 폭(px)
 * @returns 이어받을 열 수, 또는 `null` — **`null` 이면 호출측이 상태를 버린다**
 *          (한 번 놓은 폭을 나중에 슬그머니 되돌리지 않기 위해).
 */
export function adoptedCols(
  adopt: AdoptedWidth | null,
  fitted: number,
  width: number,
  slack: number = ADOPT_SLACK_COLS,
): number | null {
  if (!adopt || adopt.cols <= 0) return null;
  // 사람이 폭을 바꿨다 — 그 뜻을 따른다.
  if (width !== adopt.atWidth) return null;
  // 자리가 없다. 접히는 것을 막을 방법이 없으니 그냥 맞춘다.
  if (adopt.cols > fitted) return null;
  // 너무 넓어졌다 — 이어받으면 오른쪽에 죽은 띠가 크게 남는다.
  if (fitted - adopt.cols > slack) return null;
  return adopt.cols;
}
