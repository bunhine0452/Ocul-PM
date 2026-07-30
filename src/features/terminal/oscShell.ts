/**
 * OSC 133(셸 명령 경계) · OSC 7(작업 디렉터리) 페이로드 파서 + 상태 리듀서.
 *
 * 전부 순수 함수다 — xterm 도 DOM 도 모른다. OSC 핸들러는 xterm 파서 스레드에서
 * **동기로** 돌기 때문에(비동기를 돌려주면 파서가 멈춰 터미널 출력 전체가 정지),
 * 여기 있는 함수들은 절대 I/O 를 하지 않고 즉시 반환한다.
 *
 * # 신뢰 모델
 *
 * 터미널로 흘러드는 바이트는 전부 적대적 입력이다 — `cat evil.txt` 하나면
 * 아무 파일이나 OSC 를 흉내낼 수 있다. 그래서 OSC 133 은 PTY 를 띄울 때 앱이
 * 심은 nonce(`OCULPM_NONCE`)가 실린 것만 받는다. nonce 가 없거나 다르면
 * `null` 을 돌려 **조용히 버린다** — 예외를 두지 않는 게 규칙의 요점이라
 * 페이로드가 없는 `133;B` 도 nonce 를 요구한다.
 *
 * OSC 7 은 nonce 를 실을 자리가 표준에 없다. 그래서 이 값은 **표시용 힌트**로만
 * 쓰고, 경로 해석처럼 기능에 영향을 주는 곳에는 nonce 검증을 통과한 OSC 133;A
 * 의 `cwd` 만 쓴다.
 */

export type Osc133Event =
  /** A — 프롬프트 시작. 우리 스크립트는 여기에 cwd 를 함께 싣는다. */
  | { kind: "prompt-start"; cwd: string | null }
  /** B — 프롬프트 끝 = 사용자 입력 시작. */
  | { kind: "input-start" }
  /** C — 명령 실행 직전. `command` 는 실행될 명령줄. */
  | { kind: "exec"; command: string }
  /** D — 명령 종료. 셸이 코드를 안 실어 보내면 `null`. */
  | { kind: "exit"; exitCode: number | null };

/** 셸 쪽 `__oculpm_esc` 의 역변환 표. */
const ESCAPES: Readonly<Record<string, string>> = {
  x3b: ";",
  x0a: "\n",
  x0d: "\r",
  x1b: "\x1b",
  x07: "\x07",
};

/**
 * 셸이 이스케이프한 페이로드를 되돌린다.
 *
 * **한 번의 좌→우 스캔이어야 한다.** 셸은 역슬래시를 먼저 `\\` 로 부풀린 뒤
 * 나머지를 치환하므로, 순차 `replace` 로 되돌리면 리터럴 `\x3b`(백슬래시 + "x3b"
 * 네 글자)가 `\;` 로 뭉개진다 — 페이로드 `\\x3b` 안에서 `\x3b` 가 오검출되기
 * 때문이다. 알 수 없는 이스케이프는 백슬래시를 그대로 두고 지나간다.
 */
export function unescapeOscPayload(raw: string): string {
  if (!raw.includes("\\")) return raw;
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== "\\") {
      out += raw[i];
      continue;
    }
    const seq = ESCAPES[raw.slice(i + 1, i + 4)];
    if (seq !== undefined) {
      out += seq;
      i += 3;
    } else if (raw[i + 1] === "\\") {
      out += "\\";
      i += 1;
    } else {
      out += "\\";
    }
  }
  return out;
}

/**
 * `key=value` 조각들을 객체로. 프로토타입 없는 객체를 쓴다 — 셸 출력은
 * 신뢰할 수 없는 입력이고 `__proto__=…` 하나로 오염될 수 있다.
 */
function parseFields(parts: readonly string[]): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq)] = unescapeOscPayload(part.slice(eq + 1));
  }
  return out;
}

/**
 * OSC 133 페이로드(`133;` 뒤 전부)를 파싱한다. nonce 가 맞지 않으면 `null`.
 *
 * 페이로드 안의 진짜 `;` 는 셸이 `\x3b` 로 escape 했으므로 `;` 분리는 안전하다.
 */
export function parseOsc133(payload: string, nonce: string): Osc133Event | null {
  if (!nonce) return null; // nonce 를 모르는 세션은 아무것도 믿지 않는다.
  const parts = payload.split(";");
  const rest = parts.slice(1);

  switch (parts[0]) {
    case "A": {
      const fields = parseFields(rest);
      if (fields.nonce !== nonce) return null;
      return { kind: "prompt-start", cwd: fields.cwd || null };
    }
    case "B": {
      const fields = parseFields(rest);
      if (fields.nonce !== nonce) return null;
      return { kind: "input-start" };
    }
    case "C": {
      const fields = parseFields(rest);
      if (fields.nonce !== nonce) return null;
      return { kind: "exec", command: fields.cmd ?? "" };
    }
    case "D": {
      // `D;<exit>;nonce=…` — 첫 조각만 위치 인자다. 종료코드를 안 싣는
      // 구현(`D;nonce=…`)도 받아준다.
      const positional = rest.length > 0 && !rest[0].includes("=") ? rest[0] : null;
      const fields = parseFields(rest);
      if (fields.nonce !== nonce) return null;
      const parsed = positional === null ? Number.NaN : Number.parseInt(positional, 10);
      return { kind: "exit", exitCode: Number.isNaN(parsed) ? null : parsed };
    }
    default:
      return null;
  }
}

/**
 * OSC 7 페이로드(`file://<host><path>`)에서 경로만 뽑는다. 형식이 아니면 `null`.
 *
 * 우리 스크립트는 percent-encoding 없이 쏘지만(한글 경로를 zsh 순수 확장으로
 * 인코딩하는 건 명령마다 도는 코드에 비싸다), 남이 쏜 정상 인코딩도 받아준다.
 * 디코딩이 깨지면(경로에 리터럴 `%`) 원문을 그대로 쓴다.
 */
export function parseOsc7(payload: string): string | null {
  if (!payload.startsWith("file://")) return null;
  const afterScheme = payload.slice("file://".length);
  const slash = afterScheme.indexOf("/");
  if (slash < 0) return null;
  const path = afterScheme.slice(slash);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** 셸 통합으로 알게 된 것들. 순수 리듀서가 만들고, 상태바/에이전트 감지가 읽는다. */
export interface ShellState {
  /** nonce 유효 신호를 한 번이라도 받았다 = 통합이 실제로 켜져 있다. */
  active: boolean;
  /** 마지막으로 확인된 작업 디렉터리 (nonce 검증된 A 에서만). */
  cwd: string | null;
  /** 지금 실행 중인 명령 (C 수신 후 D 이전). */
  running: { command: string; startedAt: number } | null;
  /** 직전에 끝난 명령. */
  last: { command: string; exitCode: number | null; durationMs: number } | null;
}

export const initialShellState: ShellState = {
  active: false,
  cwd: null,
  running: null,
  last: null,
};

/**
 * 이벤트 하나를 상태에 반영한다. 순수 함수 — `now` 는 주입받는다(테스트 결정성).
 * 바뀔 게 없으면 **같은 객체를 그대로** 돌려줘 React 가 렌더를 건너뛰게 한다.
 */
export function reduceShellState(
  state: ShellState,
  event: Osc133Event,
  now: number,
): ShellState {
  switch (event.kind) {
    case "prompt-start": {
      const cwd = event.cwd ?? state.cwd;
      if (state.active && state.cwd === cwd && state.running === null) return state;
      // 프롬프트가 다시 떴다 = 실행 중인 명령은 없다 (D 를 놓쳤어도 여기서 회수).
      return { ...state, active: true, cwd, running: null };
    }
    case "input-start":
      return state.active ? state : { ...state, active: true };
    case "exec":
      return {
        ...state,
        active: true,
        running: { command: event.command, startedAt: now },
      };
    case "exit": {
      // running 이 없으면(C 를 놓쳤거나 리플레이 중간부터 붙은 경우) 명령줄을
      // 지어내지 않는다 — 빈 문자열로 두고 소요시간도 0 으로 둔다.
      const running = state.running;
      return {
        ...state,
        active: true,
        running: null,
        last: {
          command: running?.command ?? "",
          exitCode: event.exitCode,
          durationMs: running ? Math.max(0, now - running.startedAt) : 0,
        },
      };
    }
  }
}
