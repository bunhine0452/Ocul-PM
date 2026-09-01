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
