// Shift+Enter 는 에이전트의 입력 칸에서만 줄바꿈 (11-15 합류 G-03). 대체 화면만 보던 첫 판은 vim · nano · less 에도
// ESC CR 을 보내, vim 입력 모드의 Shift+Enter 가 ESC 로 노멀 모드에 빠지고 CR 로 한 줄 내려갔다. 에이전트인지는 보통
// 화면으로 돌아온 뒤에 온 상태 신호(OSC 7501)로 가린다(`agentScreen.ts`) — 세션의 상태 기록은 claude 가 지우지 않고
// 끝나면 남아서 같은 셸의 vim 까지 에이전트로 보였다.
import { afterEach, describe, expect, it } from "vitest";

import { translateKey, type KeyCtx, type KeyEventLike } from "@/features/terminal/termKeys";
import { fireKey, openRealTerm, type RealTerm } from "./xtermHarness";

const shiftEnter: KeyEventLike = {
  type: "keydown",
  key: "Enter",
  code: "Enter",
  keyCode: 13,
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: true,
};
const ctx = (over: Partial<KeyCtx>): KeyCtx => ({ platform: "mac", altScreen: false, agent: false, hasSelection: false, ...over });

describe("Shift+Enter — the key layer's table", () => {
  it.each([
    ["an agent on the alternate screen → ESC CR", { altScreen: true, agent: true }, { kind: "send", seq: "\x1b\r" }],
    ["the alternate screen without an agent (vim · nano · less) → CR", { altScreen: true, agent: false }, null],
    ["an agent signal on the normal screen → CR", { altScreen: false, agent: true }, null],
    ["the normal screen (shell) → CR", { altScreen: false, agent: false }, null],
  ] as const)("%s", (_name, over, want) => {
    expect(translateKey(shiftEnter, ctx(over))).toEqual(want);
    expect(translateKey(shiftEnter, ctx({ ...over, platform: "windows" }))).toEqual(want);
  });
});

describe("Shift+Enter through the bridge — real xterm, wired like a session", () => {
  let rt: RealTerm | null = null;
  afterEach(() => {
    rt?.dispose();
    rt = null;
  });

  /** Shift+Enter 한 번 — PTY 로 나간 바이트. 브라우저처럼 keydown 이 막히면 keypress 는 오지 않는다. */
  const press = (r: RealTerm): string => {
    r.data.splice(0);
    const down = fireKey(r, "keydown", { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });
    if (!down.defaultPrevented) fireKey(r, "keypress", { key: "Enter", code: "Enter", keyCode: 13, charCode: 13, shiftKey: true });
    fireKey(r, "keyup", { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });
    return r.data.join("");
  };

  it("claude (probe, then its full screen) gets the newline; vim opened after it in the same shell gets a plain CR", async () => {
    rt = openRealTerm();
    // claude 의 시작 — 탐침은 대체 화면에 들어서기 전에 온다.
    await rt.write("\x1b]7501;?\x1b\\\x1b[?1049h");
    expect(press(rt)).toBe("\x1b\r");
    // claude 가 지우지 않고(state=clear 없이) 끝나 셸로 돌아오고, 같은 셸에서 vim 이 대체 화면에 선다.
    await rt.write("\x1b]7501;state=idle:app=claude\x1b\\\x1b[?1049l$ vim notes.md\r\n\x1b[?1049h");
    expect(rt.term.buffer.active.type).toBe("alternate");
    expect(press(rt)).toBe("\r");
  });

  it("forgets the agent when it lets go (state=clear) — not when a sub-agent clears its own record", async () => {
    rt = openRealTerm();
    await rt.write("\x1b[?1049h\x1b]7501;state=working:app=claude\x1b\\\x1b]7501;id=task/1:state=clear\x1b\\");
    expect(press(rt)).toBe("\x1b\r");
    await rt.write("\x1b]7501;state=clear\x1b\\");
    expect(press(rt)).toBe("\r");
  });

  it("the shell (normal screen) keeps a plain CR even right after a status signal", async () => {
    rt = openRealTerm();
    await rt.write("\x1b]7501;state=idle\x1b\\");
    expect(press(rt)).toBe("\r");
  });
});

// Ctrl+G 바깥 편집기 (love-round 11-23) — claude 가 보통 화면으로 내려가 편집기를 띄우고, 닫히면 대체 화면으로 돌아온다.
// 그 사이 상태 신호가 없어 돌아온 claude 의 Shift+Enter 가 제출이 됐다.
describe("Shift+Enter after Claude's external editor (Ctrl+G)", () => {
  let rt: RealTerm | null = null;
  let clock = 0;
  afterEach(() => {
    rt?.dispose();
    rt = null;
  });

  const press = (r: RealTerm): string => {
    r.data.splice(0);
    const down = fireKey(r, "keydown", { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });
    if (!down.defaultPrevented) fireKey(r, "keypress", { key: "Enter", code: "Enter", keyCode: 13, charCode: 13, shiftKey: true });
    fireKey(r, "keyup", { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });
    return r.data.join("");
  };
  const openClaude = async (): Promise<RealTerm> => {
    clock = 1_000_000;
    const r = openRealTerm({ now: () => clock });
    await r.write("\x1b]7501;?\x1b\\\x1b[?1049h\x1b]7501;state=idle:app=claude\x1b\\");
    expect(press(r)).toBe("\x1b\r");
    return r;
  };

  it("vim as the editor keeps a plain CR, and Claude gets its newline back when vim closes", async () => {
    rt = await openClaude();
    // Ctrl+G — claude 가 내려가고 곧바로 vim 이 대체 화면에 선다.
    await rt.write("\x1b[?1049l");
    clock += 40;
    await rt.write("\x1b[?1049h");
    expect(press(rt)).toBe("\r");
    // 한참 쓰고 :wq — vim 이 내려가고 곧바로 claude 가 돌아온다.
    clock += 120_000;
    await rt.write("\x1b[?1049l");
    clock += 30;
    await rt.write("\x1b[?1049h");
    expect(press(rt)).toBe("\x1b\r");
  });

  it("a window editor (no alternate screen) — Claude coming back later gets its newline", async () => {
    rt = await openClaude();
    await rt.write("\x1b[?1049l");
    clock += 90_000;
    await rt.write("\x1b[?1049h");
    expect(press(rt)).toBe("\x1b\r");
  });

  it("forgets once the person types at the shell — vim opened by hand after Claude died stays a plain CR", async () => {
    rt = await openClaude();
    await rt.write("\x1b[?1049l$ ");
    clock += 5_000;
    fireKey(rt, "keydown", { key: "v", code: "KeyV", keyCode: 86 });
    fireKey(rt, "keypress", { key: "v", code: "KeyV", keyCode: 118, charCode: 118 });
    clock += 5_000;
    await rt.write("\x1b[?1049h");
    expect(press(rt)).toBe("\r");
    clock += 60_000;
    await rt.write("\x1b[?1049l");
    clock += 10;
    await rt.write("\x1b[?1049h");
    expect(press(rt)).toBe("\r");
  });

  it("state=clear while away forgets the agent", async () => {
    rt = await openClaude();
    await rt.write("\x1b[?1049l\x1b]7501;state=clear\x1b\\");
    clock += 90_000;
    await rt.write("\x1b[?1049h");
    expect(press(rt)).toBe("\r");
  });
});
