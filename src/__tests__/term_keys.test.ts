// 터미널 키 층 (업그레이드 라운드 TI-01 · TI-02 · TI-03) — xterm 5.5 가 손버릇과 다르게 보내는 키.
import { afterEach, describe, expect, it, vi } from "vitest";

import { translateKey, type KeyCtx, type KeyEventLike } from "@/features/terminal/termKeys";
import { __setPlatformForTests } from "@/lib/platform";
import { fireKey, openRealTerm, type RealTerm } from "./xtermHarness";

const MAC: KeyCtx = { isMac: true, altScreen: false, hasSelection: false };
const PC: KeyCtx = { isMac: false, altScreen: false, hasSelection: false };

function ev(init: Partial<KeyEventLike>): KeyEventLike {
  return {
    type: "keydown",
    key: "",
    code: "",
    keyCode: 0,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  };
}

const shiftEnter = ev({ key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });

describe("Shift+Enter — the newline of Claude's input (TI-01)", () => {
  it("sends ESC CR on the alternate screen, leaves the normal screen (shell) alone", () => {
    expect(translateKey(shiftEnter, { ...MAC, altScreen: true })).toEqual({ kind: "send", seq: "\x1b\r" });
    expect(translateKey(shiftEnter, { ...PC, altScreen: true })).toEqual({ kind: "send", seq: "\x1b\r" });
    expect(translateKey(shiftEnter, MAC)).toBeNull();
  });

  it("never while the IME is composing, and not with another modifier", () => {
    const alt = { ...MAC, altScreen: true };
    expect(translateKey({ ...shiftEnter, isComposing: true }, alt)).toBeNull();
    expect(translateKey({ ...shiftEnter, keyCode: 229 }, alt)).toBeNull();
    expect(translateKey({ ...shiftEnter, ctrlKey: true }, alt)).toBeNull();
    expect(translateKey({ ...shiftEnter, metaKey: true }, alt)).toBeNull();
    expect(translateKey(ev({ key: "Enter", keyCode: 13 }), alt)).toBeNull();
    expect(translateKey({ ...shiftEnter, type: "keyup" }, alt)).toBeNull();
  });
});

describe("macOS line editing (TI-02)", () => {
  it.each([
    ["⌘⌫", ev({ key: "Backspace", code: "Backspace", keyCode: 8, metaKey: true }), "\x15"],
    ["⌘←", ev({ key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, metaKey: true }), "\x01"],
    ["⌘→", ev({ key: "ArrowRight", code: "ArrowRight", keyCode: 39, metaKey: true }), "\x05"],
    ["⌥←", ev({ key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, altKey: true }), "\x1bb"],
    ["⌥→", ev({ key: "ArrowRight", code: "ArrowRight", keyCode: 39, altKey: true }), "\x1bf"],
    ["⌃/", ev({ key: "/", code: "Slash", keyCode: 191, ctrlKey: true }), "\x1f"],
    ["⌃2", ev({ key: "2", code: "Digit2", keyCode: 50, ctrlKey: true }), "\x00"],
    ["⌃Space", ev({ key: " ", code: "Space", keyCode: 32, ctrlKey: true }), "\x00"],
  ])("%s", (_name, event, seq) => {
    expect(translateKey(event, MAC)).toEqual({ kind: "send", seq });
    // 맥이 아니면 이 키들은 xterm 몫이다.
    expect(translateKey(event, PC)).toBeNull();
  });

  it("leaves ⌥⌘+arrows (pane move), ⇧⌘← and plain keys to the screen and xterm", () => {
    expect(translateKey(ev({ key: "ArrowLeft", keyCode: 37, metaKey: true, altKey: true }), MAC)).toBeNull();
    expect(translateKey(ev({ key: "ArrowLeft", keyCode: 37, metaKey: true, shiftKey: true }), MAC)).toBeNull();
    expect(translateKey(ev({ key: "ArrowLeft", keyCode: 37 }), MAC)).toBeNull();
    expect(translateKey(ev({ key: "Backspace", keyCode: 8 }), MAC)).toBeNull();
    expect(translateKey(ev({ key: "c", code: "KeyC", keyCode: 67, metaKey: true }), MAC)).toBeNull();
    expect(translateKey(ev({ key: "c", code: "KeyC", keyCode: 67, ctrlKey: true }), MAC)).toBeNull();
  });
});

describe("Windows · Linux copy and paste (TI-03)", () => {
  const sel = { ...PC, hasSelection: true };
  const ctrl = (key: string, extra: Partial<KeyEventLike> = {}) =>
    ev({ key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), ctrlKey: true, ...extra });

  it("Ctrl+V · Ctrl+Shift+V paste, Ctrl+Shift+C copies", () => {
    expect(translateKey(ctrl("v"), PC)).toEqual({ kind: "native", op: "paste" });
    expect(translateKey(ctrl("V", { shiftKey: true }), PC)).toEqual({ kind: "native", op: "paste" });
    expect(translateKey(ctrl("C", { shiftKey: true }), PC)).toEqual({ kind: "native", op: "copy" });
  });

  it("Ctrl+C copies only with a selection — without one it stays the interrupt", () => {
    expect(translateKey(ctrl("c"), sel)).toEqual({ kind: "native", op: "copy" });
    expect(translateKey(ctrl("c"), PC)).toBeNull();
  });

  it("reads the Latin key on a Korean 2-set layout from `code`", () => {
    // 두벌식에서 V 자리의 key 는 「ㅍ」 다.
    expect(translateKey(ctrl("v", { key: "ㅍ" }), PC)).toEqual({ kind: "native", op: "paste" });
  });

  it("is not the macOS rule — ⌘V · ⌘C stay with the browser there", () => {
    expect(translateKey(ctrl("v"), MAC)).toBeNull();
    expect(translateKey(ev({ key: "v", code: "KeyV", keyCode: 86, metaKey: true }), MAC)).toBeNull();
  });
});

describe("the key layer inside the bridge (real xterm)", () => {
  let rt: RealTerm | null = null;
  afterEach(() => {
    rt?.dispose();
    rt = null;
  });

  it("alternate screen: Shift+Enter reaches the PTY as one ESC CR and no CR", async () => {
    rt = openRealTerm();
    await rt.write("\x1b[?1049h");
    expect(rt.term.buffer.active.type).toBe("alternate");
    const down = fireKey(rt, "keydown", { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });
    fireKey(rt, "keypress", { key: "Enter", code: "Enter", keyCode: 13, charCode: 13, shiftKey: true });
    fireKey(rt, "keyup", { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });
    expect(rt.data).toEqual(["\x1b\r"]);
    expect(down.defaultPrevented).toBe(true);
  });

  it("normal screen (shell): Shift+Enter stays a plain CR", () => {
    rt = openRealTerm();
    fireKey(rt, "keydown", { key: "Enter", code: "Enter", keyCode: 13, shiftKey: true });
    expect(rt.data).toEqual(["\r"]);
  });

  it("⌘⌫ sends ⌃U and stops the screen shortcuts from seeing the key", () => {
    rt = openRealTerm();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    fireKey(rt, "keydown", { key: "Backspace", code: "Backspace", keyCode: 8, metaKey: true });
    window.removeEventListener("keydown", onWindow);
    expect(rt.data).toEqual(["\x15"]);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it("Windows: Ctrl+V leaves the PTY alone so the browser's paste event does the work", () => {
    __setPlatformForTests("windows");
    rt = openRealTerm();
    const down = fireKey(rt, "keydown", { key: "v", code: "KeyV", keyCode: 86, ctrlKey: true });
    expect(rt.data).toEqual([]); // 예전에는 0x16 이 나갔다
    expect(down.defaultPrevented).toBe(false); // 기본 동작(붙여넣기)은 살려 둔다
  });
});
