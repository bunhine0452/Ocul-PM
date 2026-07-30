import { describe, expect, it } from "vitest";
import {
  initialShellState,
  parseOsc7,
  parseOsc133,
  reduceShellState,
  unescapeOscPayload,
  type Osc133Event,
  type ShellState,
} from "@/features/terminal/oscShell";
import {
  formatDuration,
  summarizeShell,
  truncateCommand,
} from "@/features/terminal/shellStatus";

const NONCE = "d41d8cd98f00b204e9800998ecf8427e";

/**
 * `templates/oculpm.zsh` 의 `__oculpm_esc` 와 **같은 순서**로 이스케이프한다
 * (역슬래시 먼저). 파서 테스트가 실제 셸이 쏘는 바이트를 상대하도록.
 */
function shellEscape(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\x3b")
    .replace(/\n/g, "\\x0a")
    .replace(/\r/g, "\\x0d")
    .replace(/\x1b/g, "\\x1b")
    .replace(/\x07/g, "\\x07");
}

describe("unescapeOscPayload", () => {
  it("셸 이스케이프를 왕복 복원한다", () => {
    for (const raw of [
      "/Users/kim/작업 폴더",
      "git commit -m 'fix; then ship'",
      "echo a\nb",
      "printf '\x1b[31m'",
      "plain-ascii",
    ]) {
      expect(unescapeOscPayload(shellEscape(raw))).toBe(raw);
    }
  });

  /**
   * 회귀 방어 — 순차 replace 로 되돌리면 여기서 깨진다. 리터럴 `\x3b`(4글자)는
   * 셸에서 `\\x3b` 로 나오는데, `\x3b`→`;` 를 먼저 돌리면 `\;` 가 된다.
   */
  it("리터럴 백슬래시 뒤 x3b 를 세미콜론으로 오인하지 않는다", () => {
    expect(shellEscape("\\x3b")).toBe("\\\\x3b");
    expect(unescapeOscPayload("\\\\x3b")).toBe("\\x3b");
  });

  it("알 수 없는 이스케이프는 백슬래시를 그대로 둔다", () => {
    expect(unescapeOscPayload("C:\\path\\to")).toBe("C:\\path\\to");
  });

  it("백슬래시가 없으면 원문을 그대로 돌려준다", () => {
    const raw = "no escapes here";
    expect(unescapeOscPayload(raw)).toBe(raw);
  });
});

describe("parseOsc133", () => {
  it("A 는 cwd 를 실어 프롬프트 시작을 알린다", () => {
    const payload = `A;nonce=${NONCE};cwd=${shellEscape("/Users/kim/작업 폴더")}`;
    expect(parseOsc133(payload, NONCE)).toEqual({
      kind: "prompt-start",
      cwd: "/Users/kim/작업 폴더",
    });
  });

  it("B 는 입력 시작", () => {
    expect(parseOsc133(`B;nonce=${NONCE}`, NONCE)).toEqual({ kind: "input-start" });
  });

  it("C 는 세미콜론이 든 명령줄도 온전히 복원한다", () => {
    const cmd = "git add -A; git commit -m 'wip'";
    expect(parseOsc133(`C;nonce=${NONCE};cmd=${shellEscape(cmd)}`, NONCE)).toEqual({
      kind: "exec",
      command: cmd,
    });
  });

  it("D 는 종료코드를 위치 인자에서 읽는다", () => {
    expect(parseOsc133(`D;0;nonce=${NONCE}`, NONCE)).toEqual({ kind: "exit", exitCode: 0 });
    expect(parseOsc133(`D;130;nonce=${NONCE}`, NONCE)).toEqual({ kind: "exit", exitCode: 130 });
  });

  it("종료코드를 안 싣는 D 도 받아준다", () => {
    expect(parseOsc133(`D;nonce=${NONCE}`, NONCE)).toEqual({ kind: "exit", exitCode: null });
  });

  // --- 신뢰 경계 ---

  it("nonce 가 다르면 전부 버린다 (터미널로 흘러든 위조 신호)", () => {
    for (const payload of [
      "A;nonce=attacker;cwd=/etc",
      "B;nonce=attacker",
      "C;nonce=attacker;cmd=rm -rf /",
      "D;0;nonce=attacker",
    ]) {
      expect(parseOsc133(payload, NONCE)).toBeNull();
    }
  });

  it("nonce 가 아예 없는 페이로드도 버린다", () => {
    expect(parseOsc133("A;cwd=/etc", NONCE)).toBeNull();
    expect(parseOsc133("B", NONCE)).toBeNull();
    expect(parseOsc133("D;0", NONCE)).toBeNull();
  });

  it("세션 nonce 를 모르면(빈 문자열) 아무것도 믿지 않는다", () => {
    expect(parseOsc133("A;nonce=;cwd=/etc", "")).toBeNull();
    expect(parseOsc133(`A;nonce=${NONCE};cwd=/etc`, "")).toBeNull();
  });

  it("알 수 없는 마커는 무시한다", () => {
    expect(parseOsc133(`P;k=c;nonce=${NONCE}`, NONCE)).toBeNull();
    expect(parseOsc133("", NONCE)).toBeNull();
  });

  it("__proto__ 필드로 프로토타입을 오염시키지 못한다", () => {
    const event = parseOsc133(`A;__proto__=polluted;nonce=${NONCE};cwd=/tmp`, NONCE);
    expect(event).toEqual({ kind: "prompt-start", cwd: "/tmp" });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("cwd 가 비면 null 로 (빈 문자열을 경로로 쓰지 않는다)", () => {
    expect(parseOsc133(`A;nonce=${NONCE};cwd=`, NONCE)).toEqual({
      kind: "prompt-start",
      cwd: null,
    });
  });
});

describe("parseOsc7", () => {
  it("file:// URL 에서 경로만 뽑는다", () => {
    expect(parseOsc7("file://mac.local/Users/kim/repo")).toBe("/Users/kim/repo");
    expect(parseOsc7("file://localhost/tmp")).toBe("/tmp");
  });

  it("percent-encoding 을 디코딩한다", () => {
    expect(parseOsc7("file://h/Users/kim/%ED%95%9C%EA%B8%80")).toBe("/Users/kim/한글");
  });

  it("인코딩 안 된 한글 경로(우리 스크립트 출력)도 그대로 통과", () => {
    expect(parseOsc7("file://h/Users/kim/한글 폴더")).toBe("/Users/kim/한글 폴더");
  });

  it("디코딩 불가능한 리터럴 % 는 원문을 쓴다", () => {
    expect(parseOsc7("file://h/tmp/100%done")).toBe("/tmp/100%done");
  });

  it("file:// 형식이 아니면 null", () => {
    expect(parseOsc7("https://example.com/x")).toBeNull();
    expect(parseOsc7("file://hostonly")).toBeNull();
    expect(parseOsc7("")).toBeNull();
  });
});

describe("reduceShellState", () => {
  const run = (events: Osc133Event[], times: number[]): ShellState =>
    events.reduce((s, e, i) => reduceShellState(s, e, times[i]), initialShellState);

  it("실행→종료로 소요시간과 종료코드를 남긴다", () => {
    const state = run(
      [
        { kind: "prompt-start", cwd: "/repo" },
        { kind: "input-start" },
        { kind: "exec", command: "pnpm test" },
        { kind: "exit", exitCode: 1 },
      ],
      [1000, 1000, 1000, 4500],
    );
    expect(state.active).toBe(true);
    expect(state.cwd).toBe("/repo");
    expect(state.running).toBeNull();
    expect(state.last).toEqual({ command: "pnpm test", exitCode: 1, durationMs: 3500 });
  });

  it("실행 중에는 running 이 채워진다", () => {
    expect(run([{ kind: "exec", command: "claude" }], [10]).running).toEqual({
      command: "claude",
      startedAt: 10,
    });
  });

  it("D 를 놓쳐도 다음 프롬프트에서 running 을 회수한다", () => {
    const state = run(
      [
        { kind: "exec", command: "vim" },
        { kind: "prompt-start", cwd: "/repo" },
      ],
      [0, 100],
    );
    expect(state.running).toBeNull();
  });

  it("C 없이 D 만 오면 명령줄을 지어내지 않는다", () => {
    expect(run([{ kind: "exit", exitCode: 0 }], [50]).last).toEqual({
      command: "",
      exitCode: 0,
      durationMs: 0,
    });
  });

  it("바뀔 게 없으면 같은 객체를 돌려준다 (불필요한 렌더 방지)", () => {
    const settled = run(
      [
        { kind: "prompt-start", cwd: "/repo" },
        { kind: "input-start" },
      ],
      [0, 0],
    );
    expect(reduceShellState(settled, { kind: "input-start" }, 1)).toBe(settled);
    expect(reduceShellState(settled, { kind: "prompt-start", cwd: "/repo" }, 1)).toBe(settled);
  });

  it("cwd 없는 A 는 직전 cwd 를 지우지 않는다", () => {
    const state = run(
      [
        { kind: "prompt-start", cwd: "/repo" },
        { kind: "prompt-start", cwd: null },
      ],
      [0, 1],
    );
    expect(state.cwd).toBe("/repo");
  });

  it("입력 상태를 변경하지 않는다 (불변성)", () => {
    const before = { ...initialShellState };
    reduceShellState(initialShellState, { kind: "exec", command: "ls" }, 5);
    expect(initialShellState).toEqual(before);
  });
});

describe("formatDuration", () => {
  it("1초 미만은 표시하지 않는다 (ls 에 12ms 는 소음)", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(999)).toBe("");
  });

  it("분·시간 단위로 올라간다", () => {
    expect(formatDuration(1000)).toBe("1초");
    expect(formatDuration(59_400)).toBe("59초");
    expect(formatDuration(60_000)).toBe("1분");
    expect(formatDuration(95_000)).toBe("1분 35초");
    expect(formatDuration(3_600_000)).toBe("1시간 0분");
    expect(formatDuration(7_500_000)).toBe("2시간 5분");
  });

  it("숫자가 아니면 빈 문자열", () => {
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("truncateCommand", () => {
  it("짧은 명령은 그대로, 공백은 정규화한다", () => {
    expect(truncateCommand("git   status")).toBe("git status");
  });

  it("가운데를 생략해 앞뒤를 모두 남긴다", () => {
    // max=20 → 앞 10자 + "…" + 뒤 9자.
    const out = truncateCommand("pnpm vitest run src/__tests__/osc_shell.test.ts", 20);
    expect(out).toBe("pnpm vites…l.test.ts");
    expect(out.startsWith("pnpm vite")).toBe(true);
    expect(out.endsWith(".ts")).toBe(true);
  });

  it("극단적으로 좁은 폭도 깨지지 않는다", () => {
    expect(truncateCommand("aaaaaa", 1)).toBe("…");
  });
});

describe("summarizeShell", () => {
  const base = { ...initialShellState, active: true };

  it("통합이 꺼져 있으면 아무것도 보여주지 않는다", () => {
    expect(summarizeShell(initialShellState)).toBeNull();
  });

  it("실행 중이면 명령을 보여준다", () => {
    const s = summarizeShell({ ...base, running: { command: "claude", startedAt: 0 } });
    expect(s).toEqual({ text: "claude 실행 중", tone: "running" });
  });

  it("성공은 소요시간을 붙인다", () => {
    const s = summarizeShell({
      ...base,
      last: { command: "pnpm build", exitCode: 0, durationMs: 12_000 },
    });
    expect(s).toEqual({ text: "pnpm build 완료 · 12초", tone: "ok" });
  });

  it("실패는 종료코드를 남긴다", () => {
    const s = summarizeShell({
      ...base,
      last: { command: "pnpm test", exitCode: 1, durationMs: 500 },
    });
    expect(s).toEqual({ text: "pnpm test 실패 1", tone: "fail" });
  });

  it("128+N 은 시그널 이름으로 (⌃C 를 '실패 130' 이라 하지 않는다)", () => {
    const s = summarizeShell({
      ...base,
      last: { command: "sleep 99", exitCode: 130, durationMs: 2000 },
    });
    expect(s).toEqual({ text: "sleep 99 SIGINT · 2초", tone: "fail" });
  });

  it("아직 명령을 안 돌린 세션은 켜짐만 알린다", () => {
    expect(summarizeShell(base)).toEqual({ text: "셸 통합 켜짐", tone: "idle" });
  });

  it("명령줄을 못 받은 종료는 앞말을 지어내지 않는다", () => {
    expect(summarizeShell({ ...base, last: { command: "", exitCode: 0, durationMs: 0 } })).toEqual({
      text: "완료",
      tone: "ok",
    });
  });
});
