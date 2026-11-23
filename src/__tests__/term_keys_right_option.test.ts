// 맥 오른쪽 ⌥ 는 글자 (love-round 11-23) — macOptionIsMeta 가 모든 ⌥ 를 Meta 로 보내, ⌥ 로 글자를 만드는 배열(독일어
// ⌥L = @ 등)에서 @ 하나를 못 쳤다. Ghostty 의 `macos-option-as-alt = left` 처럼 오른쪽만 글자, 왼쪽은 Meta 그대로.
import { afterEach, describe, expect, it } from "vitest";

import { translateKey, type KeyCtx, type KeyEventLike } from "@/features/terminal/termKeys";
import { __setPlatformForTests } from "@/lib/platform";
import { fireKey, openRealTerm, type RealTerm } from "./xtermHarness";

const MAC: KeyCtx = { platform: "mac", altScreen: false, agent: false, hasSelection: false };

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

const optL = ev({ key: "@", code: "KeyL", keyCode: 76, altKey: true });

describe("right ⌥ — the key layer's table", () => {
  it("right ⌥ sends the character the layout made, ⇧ included", () => {
    expect(translateKey(optL, { ...MAC, rightOption: true })).toEqual({ kind: "send", seq: "@" });
    expect(translateKey(ev({ key: "€", code: "KeyE", altKey: true }), { ...MAC, rightOption: true })).toEqual({ kind: "send", seq: "€" });
    expect(translateKey(ev({ key: "\\", code: "Digit7", altKey: true, shiftKey: true }), { ...MAC, rightOption: true })).toEqual({
      kind: "send",
      seq: "\\",
    });
  });

  it("left ⌥ stays Meta (xterm's ESC + key), and right ⌥ arrows stay word jumps", () => {
    expect(translateKey(optL, MAC)).toBeNull();
    expect(translateKey(optL, { ...MAC, rightOption: false })).toBeNull();
    expect(translateKey(ev({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }), { ...MAC, rightOption: true })).toEqual({
      kind: "send",
      seq: "\x1bb",
    });
  });

  it("not for dead keys, ⌘ · ⌃ chords, the IME, or other systems", () => {
    const right = { ...MAC, rightOption: true };
    expect(translateKey(ev({ key: "Dead", code: "KeyE", altKey: true }), right)).toBeNull();
    expect(translateKey({ ...optL, metaKey: true }, right)).toBeNull();
    expect(translateKey({ ...optL, ctrlKey: true }, right)).toBeNull();
    expect(translateKey({ ...optL, keyCode: 229 }, right)).toBeNull();
    expect(translateKey(optL, { ...right, platform: "windows" })).toBeNull();
  });
});

describe("right ⌥ through the bridge (real xterm)", () => {
  let rt: RealTerm | null = null;
  afterEach(() => {
    rt?.dispose();
    rt = null;
    __setPlatformForTests(null);
  });

  /** ⌥ 를 쥐고 L 을 누르고 놓는다 — 브라우저처럼 keydown 이 막히면 keypress 는 오지 않는다. */
  const chord = (r: RealTerm, code: "AltRight" | "AltLeft") => {
    r.data.splice(0);
    fireKey(r, "keydown", { key: "Alt", code, keyCode: 18, altKey: true });
    const down = fireKey(r, "keydown", { key: "@", code: "KeyL", keyCode: 76, altKey: true });
    if (!down.defaultPrevented) fireKey(r, "keypress", { key: "@", code: "KeyL", keyCode: 64, charCode: 64, altKey: true });
    fireKey(r, "keyup", { key: "@", code: "KeyL", keyCode: 76, altKey: true });
    fireKey(r, "keyup", { key: "Alt", code, keyCode: 18 });
    return r.data.join("");
  };

  it("right ⌥ L reaches the PTY as @; left ⌥ L does not", () => {
    __setPlatformForTests("mac");
    rt = openRealTerm();
    expect(chord(rt, "AltRight")).toBe("@");
    expect(chord(rt, "AltLeft")).not.toBe("@");
  });

  it("letting go of right ⌥ outside the window does not leave it held", () => {
    __setPlatformForTests("mac");
    rt = openRealTerm();
    fireKey(rt, "keydown", { key: "Alt", code: "AltRight", keyCode: 18, altKey: true });
    // keyup 을 못 받고 돌아와 ⌥ 없이 친 키 — 그다음 왼쪽 ⌥ 는 다시 Meta 다.
    fireKey(rt, "keydown", { key: "a", code: "KeyA", keyCode: 65 });
    rt.data.splice(0);
    fireKey(rt, "keydown", { key: "Alt", code: "AltLeft", keyCode: 18, altKey: true });
    const down = fireKey(rt, "keydown", { key: "@", code: "KeyL", keyCode: 76, altKey: true });
    expect(down.defaultPrevented && rt.data.join("") === "@").toBe(false);
  });
});
