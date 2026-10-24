// 터미널 → PTY 쓰기는 **세션마다 한 줄로** 간다 (크로스플랫폼 라운드 {#ui-term-write-order}).
//
// 예전에는 키마다 `void commands.writeToPty(...)` 를 따로 쐈다. 호출 하나하나가
// 독립된 IPC 라 **도착 순서를 아무도 약속하지 않는다** — 웹뷰가 요청을 병렬로
// 흘리고, 백엔드 커맨드도 각자의 태스크에서 호스트 접속을 잡으러 경주한다.
// Windows(WebView2) E2E 에서 `echo order-0123456789` 가 `roder-0124356789` 로
// 도착했다(3/3). macOS·Linux 에서 안 보였던 것은 경주 창이 좁았을 뿐, 같은
// 구조라 빠른 연타·키 반복에서 잠복해 있던 결함이다.
//
// 그래서 세션마다 **보내는 중인 쓰기는 하나**다. 그 사이에 온 입력은 버퍼에
// 이어 붙였다가 응답이 오면 한 번에 보낸다 — 순서가 구조로 보장되고, 연타는
// IPC 왕복 수가 줄어 오히려 빨라진다. 백엔드 `write_to_pty` 는 호스트가 세션
// 쓰기 큐에 넣은 **뒤에** 답하므로(`Request::Write` → `writer.enqueue`), 앞 쓰기의
// 응답을 받은 뒤 보낸 쓰기는 반드시 그 뒤에 PTY 에 닿는다.
//
// 키 입력(xterm onData — 붙여넣기·IME 확정·키 전부 여기로 온다), 갓 뜬 셸의 첫
// 명령, 디스패치 프리필, 블록 메뉴의 명령 채우기가 **전부 한 창구**(`dispatchTarget.ts`
// 의 `writePty` — 생성 바인딩을 직접 부를 수 있는 자리라 거기 산다)를 지난다.
// 창구가 둘이면 둘 사이의 순서는 다시 IPC 에 맡겨진다. 이 파일은 전송을 주입받는
// 순수 모듈이다 — 테스트가 응답 순서를 뒤섞는 가짜를 꽂는다.

export type PtyWriteResult = { status: "ok"; data: null } | { status: "error"; error: string };

/** 실제 전송 — 앱에서는 `write_to_pty`. 테스트가 응답 순서를 뒤섞는 가짜를 꽂는다. */
export type PtySend = (sessionId: string, data: string) => Promise<PtyWriteResult>;

interface Lane {
  /** 보내는 중인 쓰기 뒤에 쌓인 입력 (친 순서 그대로 이어 붙인다). */
  buffer: string;
  /** 그 입력을 기다리는 호출자들 — 묶여 나간 쓰기의 결과를 함께 받는다. */
  waiters: Array<(result: PtyWriteResult) => void>;
}

const OK: PtyWriteResult = { status: "ok", data: null };

/**
 * 세션별 직렬 쓰기 함수를 만든다. 돌려준 프라미스는 **그 데이터가 실린 쓰기**의
 * 결과로 풀린다 — 여러 호출이 한 쓰기로 묶였으면 같은 결과를 받는다.
 */
export function createPtyWriter(send: PtySend): (sessionId: string, data: string) => Promise<PtyWriteResult> {
  const lanes = new Map<string, Lane>();

  const pump = async (sessionId: string, lane: Lane) => {
    while (lane.buffer) {
      const data = lane.buffer;
      const waiters = lane.waiters;
      lane.buffer = "";
      lane.waiters = [];
      let result: PtyWriteResult;
      try {
        result = await send(sessionId, data);
      } catch (err) {
        // 전송 자체의 거절(IPC 실패) — 줄이 멈추면 뒤의 키가 영영 안 나간다.
        result = { status: "error", error: String(err) };
      }
      for (const done of waiters) done(result);
    }
    // 버퍼 검사와 여기 사이에는 await 이 없다 — 그 사이에 끼어든 입력은 없다.
    lanes.delete(sessionId);
  };

  return (sessionId, data) => {
    if (!data) return Promise.resolve(OK);
    const existing = lanes.get(sessionId);
    const lane = existing ?? { buffer: "", waiters: [] };
    lane.buffer += data;
    const done = new Promise<PtyWriteResult>((resolve) => lane.waiters.push(resolve));
    if (!existing) {
      lanes.set(sessionId, lane);
      void pump(sessionId, lane);
    }
    return done;
  };
}

/**
 * PTY 가 서기 전에 받아 두는 입력의 상한 (청크 수). 셸이 끝내 안 뜨면 이 큐는
 * 영영 안 비워지므로 무한정 자라면 안 된다 — 사람 손으로 이만큼 치는 동안
 * 셸이 안 뜬다면 그건 이미 다른 문제다.
 */
export const PENDING_INPUT_MAX = 256;

export interface PtyInputGate {
  /** xterm `onData` — 셸이 서 있으면 보내고, 아니면 받아 둔다. */
  push(data: string): void;
  /** 셸이 섰다 — 받아 둔 입력부터 친 순서대로 보낸다. */
  open(): void;
  /** 셸이 사라졌다 — 보낼 곳이 없으니 다시 받아 둔다 (백엔드는 미지의 세션을 거절한다). */
  close(): void;
}

/**
 * 한 페인의 입력 문. 등록은 **PTY 가 서기 전에** 해 둔다 (2026-09-02) — attach/
 * start 왕복(수십~수백 ms) 사이에 친 키가 사라지지 않게, 진짜 터미널의 tty
 * 버퍼 자리를 이 큐가 맡는다.
 */
export function createPtyInputGate(
  sessionId: string,
  write: (sessionId: string, data: string) => Promise<PtyWriteResult>,
  max: number = PENDING_INPUT_MAX,
  /**
   * 보낸 키가 PTY 에 닿지 못했다 (2026-10-18). 예전에는 결과를 `void` 로 버려서,
   * 호스트가 거절한 입력(`PTY input queue is full` · `unknown pty session` ·
   * 쓰기 실패)이 **사용자 눈에는 아무 일도 없는 먹통**이었다 — 호스트의 쓰기 큐
   * (`ptyhost/writer.rs`)는 "조용히 버리지 않고 오류로 말한다" 를 지키는데 그
   * 말을 들을 귀가 여기 없었다. 무엇을 보여 줄지는 부르는 쪽이 정한다.
   */
  onError?: (error: string) => void,
): PtyInputGate {
  let ready = false;
  const pending: string[] = [];
  const send = (data: string) => {
    void write(sessionId, data).then((result) => {
      if (result.status === "error") onError?.(result.error);
    });
  };
  return {
    push(data) {
      if (ready) {
        send(data);
        return;
      }
      if (pending.length < max) pending.push(data);
    },
    open() {
      ready = true;
      for (const data of pending) send(data);
      pending.length = 0;
    },
    close() {
      ready = false;
    },
  };
}

/**
 * 거절 사유가 "그 세션이 이제 없다" 인가 (2026-10-24).
 *
 * 셸이 스스로 끝나면 `pty-exit` 이 와서 페인이 「세션 끝남 · 다시 시작」 으로 바뀐다.
 * 그런데 **호스트째** 사라지면(종료·충돌·옛 판 호스트를 손으로 내림) 그 알림이 오지
 * 않는다. 페인은 살아 있는 줄 알고 키를 보내고, 새 호스트는 그 세션을 모르니 매번
 * 거절한다 — 실측 하루 31건, 사용자 눈에는 토스트만 쌓이는 먹통이었다. 이 거절을
 * 종료와 같은 신호로 읽는다.
 */
export function isSessionGone(error: string): boolean {
  return error.includes("unknown pty session");
}

/**
 * 셸·호스트가 사라졌을 때의 처리를 **한 번만** 하게 감싼다 — `pty-exit` 과 거절이
 * 겹치거나, 쌓여 있던 키 여러 개가 연달아 거절돼도 배너·콜백은 하나다.
 */
export function onceSessionEnded(end: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    end();
  };
}
