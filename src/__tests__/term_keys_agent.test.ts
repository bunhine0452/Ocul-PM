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
