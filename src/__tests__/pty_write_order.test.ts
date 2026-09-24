import { describe, expect, test, vi } from "vitest";

// 터미널 입력 순서 ({#ui-term-write-order}, E2E 발견).
//
// Windows(WebView2) 러너에서 빠르게 친 `echo order-0123456789` 가
// `roder-0124356789` 로 도착했다. 키마다 따로 쏜 `write_to_pty` 가 IPC 에서
// 순서를 잃은 것이다. 여기서는 그 IPC 를 **응답(=도착) 순서를 마음대로 뒤섞는
// 가짜 백엔드**로 흉내 낸다: 대기 중인 요청이 여럿이면 아무거나 먼저 PTY 에 닿는다.
// 한 번에 하나만 대기하게 만드는 것이 수리이므로, 수리가 있으면 섞을 것이 없다.


import {
  createPtyInputGate,
  createPtyWriter,
  PENDING_INPUT_MAX,
  type PtyWriteResult,
} from "@/features/terminal/ptyWrite";

const OK: PtyWriteResult = { status: "ok", data: null };

/** 결정적 의사 난수 — 뒤섞기 순서를 재현할 수 있게. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * 도착 순서를 뒤섞는 가짜 백엔드. `send` 는 요청을 대기열에 올리고, `settle` 이
 * 대기 중인 요청을 **무작위 순서로** 하나씩 PTY 에 도착시킨다(= 응답한다).
 */
function shufflingBackend(seed: number) {
  const random = rng(seed);
  const pty: Record<string, string> = {};
  const inFlight: Array<{ sid: string; data: string; resolve: (r: PtyWriteResult) => void }> = [];
  let maxInFlight = 0;
  const sends: string[] = [];
  const send = (sid: string, data: string) =>
    new Promise<PtyWriteResult>((resolve) => {
      sends.push(data);
      inFlight.push({ sid, data, resolve });
      maxInFlight = Math.max(maxInFlight, inFlight.length);
    });
  const settle = async () => {
    // 대기열이 빌 때까지 — 응답 하나가 다음 쓰기를 부를 수 있으므로 매번 마이크로태스크를 흘린다.
    for (let guard = 0; guard < 10_000; guard++) {
      await Promise.resolve();
      await Promise.resolve();
      if (inFlight.length === 0) return;
      const i = Math.floor(random() * inFlight.length);
      const [req] = inFlight.splice(i, 1);
      pty[req.sid] = (pty[req.sid] ?? "") + req.data;
      req.resolve(OK);
    }
    throw new Error("fake backend never drained");
  };
  return { send, settle, pty, sends, maxInFlight: () => maxInFlight };
}

const TYPED = "echo order-0123456789\r";

describe("PTY write serialization — arrival order is typing order", () => {
  test("control: one IPC per key arrives shuffled (the harness catches the defect)", async () => {
    const backend = shufflingBackend(7);
    for (const ch of TYPED) void backend.send("s1", ch);
    await backend.settle();
    expect(backend.pty.s1).not.toBe(TYPED);
    expect([...backend.pty.s1].sort().join("")).toBe([...TYPED].sort().join(""));
  });

  test.each([1, 2, 3, 42, 1234])("shuffled responses (seed %i) still reach the PTY in typing order", async (seed) => {
    const backend = shufflingBackend(seed);
    const write = createPtyWriter(backend.send);
    for (const ch of TYPED) void write("s1", ch);
    await backend.settle();
    expect(backend.pty.s1).toBe(TYPED);
    expect(backend.maxInFlight()).toBe(1);
  });

  test("keys typed while a write is in flight are coalesced into one write", async () => {
    const backend = shufflingBackend(5);
    const write = createPtyWriter(backend.send);
    for (const ch of TYPED) void write("s1", ch);
    await backend.settle();
    // 첫 키는 즉시, 나머지는 첫 응답 뒤 한 덩어리로.
    expect(backend.sends).toEqual(["e", TYPED.slice(1)]);
  });

  test("order holds when responses interleave with typing (human pace)", async () => {
    const backend = shufflingBackend(11);
    const write = createPtyWriter(backend.send);
    let i = 0;
    for (const ch of TYPED) {
      void write("s1", ch);
      if (i++ % 3 === 0) await backend.settle();
    }
    await backend.settle();
    expect(backend.pty.s1).toBe(TYPED);
  });

  test("sessions do not wait on each other — each keeps its own order", async () => {
    const backend = shufflingBackend(3);
    const write = createPtyWriter(backend.send);
    const a = "ls -la\r";
    const b = "git status\r";
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      if (a[k]) void write("a", a[k]);
      if (b[k]) void write("b", b[k]);
    }
    expect(backend.maxInFlight()).toBe(2); // 세션마다 하나씩
    await backend.settle();
    expect(backend.pty.a).toBe(a);
    expect(backend.pty.b).toBe(b);
  });

  test("coalesced callers share the result of the write that carried them", async () => {
    const results: PtyWriteResult[] = [];
    let release: (r: PtyWriteResult) => void = () => {};
    const send = vi.fn(
      (_sid: string, data: string) =>
        new Promise<PtyWriteResult>((resolve) => {
          if (data === "a") resolve(OK);
          else release = resolve;
        }),
    );
    const write = createPtyWriter(send);
    const first = write("s", "a");
    const second = write("s", "b");
    const third = write("s", "c");
    results.push(await first);
    await Promise.resolve();
    release({ status: "error", error: "unknown pty session: s" });
    results.push(await second, await third);
    expect(send.mock.calls.map((c) => c[1])).toEqual(["a", "bc"]);
    expect(results).toEqual([OK, { status: "error", error: "unknown pty session: s" }, { status: "error", error: "unknown pty session: s" }]);
  });

  test("a rejected send does not stall the lane", async () => {
    let calls = 0;
    const seen: string[] = [];
    const send = async (_sid: string, data: string): Promise<PtyWriteResult> => {
      seen.push(data);
      if (calls++ === 0) throw new Error("ipc down");
      return OK;
    };
    const write = createPtyWriter(send);
    const r1 = await write("s", "x");
    expect(r1.status).toBe("error");
    expect(await write("s", "y")).toEqual(OK);
    expect(seen).toEqual(["x", "y"]);
  });

  test("empty data is not sent", async () => {
    const send = vi.fn(async () => OK);
    const write = createPtyWriter(send);
    expect(await write("s", "")).toEqual(OK);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("input gate — keys before the shell is up and after it is gone", () => {
  test("keys typed before open are held and flushed in order ahead of later keys", async () => {
    const backend = shufflingBackend(9);
    const write = createPtyWriter(backend.send);
    const gate = createPtyInputGate("s1", write);
    for (const ch of "echo ") gate.push(ch);
    expect(backend.sends).toEqual([]);
    gate.open();
    for (const ch of "order-0123456789\r") gate.push(ch);
    await backend.settle();
    expect(backend.pty.s1).toBe(TYPED);
  });

  test("closing (shell exit) holds input again, capped at PENDING_INPUT_MAX", async () => {
    const sent: string[] = [];
    const gate = createPtyInputGate("s1", async (_sid, data) => {
      sent.push(data);
      return OK;
    });
    gate.open();
    gate.push("a");
    gate.close();
    for (let i = 0; i < PENDING_INPUT_MAX + 10; i++) gate.push("z");
    expect(sent).toEqual(["a"]);
    gate.open();
    expect(sent.length).toBe(1 + PENDING_INPUT_MAX);
  });
});
