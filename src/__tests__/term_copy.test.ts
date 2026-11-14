// 터미널 복사 정리 (업그레이드 라운드 TI-07) — 공통 왼쪽 여백 · 줄 끝 공백 · 끝 빈 줄 · 넓은 글자 줄바꿈 빈칸.
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanSelection } from "@/features/terminal/termCopy";
import { __setPlatformForTests } from "@/lib/platform";
import { fakeClipboard, fireClipboard, fireKey, openRealTerm, type RealTerm } from "./xtermHarness";

const GA = "\u{ac00}"; // 가 — 소스에 완성형을 쓰지 않는다(lint:i18n)

describe("cleanSelection", () => {
  it("strips only the indent every line shares — relative indentation stays", () => {
    expect(cleanSelection(["  a", "    b", "  c"])).toBe("a\n  b\nc");
  });

  it("drops trailing spaces on each line and trailing empty lines", () => {
    expect(cleanSelection(["  foo   ", "  bar\xa0", "", "   ", ""])).toBe("foo\nbar");
  });

  it("a line that starts at column 0 keeps everything as is", () => {
    expect(cleanSelection(["def f():", "    return 1"])).toBe("def f():\n    return 1");
  });

  it("blank lines inside do not pull the shared indent to zero", () => {
    expect(cleanSelection(["    a", "", "    b"])).toBe("a\n\nb");
  });
});

describe("the copy listener inside the bridge (real xterm)", () => {
  let rt: RealTerm | null = null;
  afterEach(() => {
    rt?.dispose();
    rt = null;
  });

  it("copy writes the cleaned selection, not xterm's raw text", async () => {
    rt = openRealTerm({ cols: 20 });
    await rt.write("  foo   \r\n    bar\r\n  baz\r\n");
    rt.term.selectAll();
    const clip = fakeClipboard("");
    const event = fireClipboard(rt, "copy", clip);
    expect(clip.written["text/plain"]).toBe("foo\n  bar\nbaz");
    expect(event.defaultPrevented).toBe(true);
    // 맥은 복사 뒤에도 선택을 남긴다(Terminal.app · iTerm2 와 같다).
    expect(rt.term.hasSelection()).toBe(true);
  });

  it("a wide character wrapped to the next row leaves no blank — and the shared indent still goes", async () => {
    // 칸 6개에 「  abc가가」 — 「가」(두 칸)가 여섯째 칸에 안 맞아 다음 줄로 넘어가며 그 칸을 비운다.
    // 빈 셀을 자르는 것은 xterm 의 선택 글(translateToString(trimRight))이고, 공통 여백(둘째 줄 「  x」 와
    // 함께 두 칸)을 걷는 것은 브리지의 복사다 — 브리지의 copy 리스너가 없으면 여백이 남아 붉어진다.
    rt = openRealTerm({ cols: 6 });
    await rt.write(`  abc${GA}${GA}\r\n  x`);
    const row0 = rt.term.buffer.active.getLine(0);
    expect(row0?.getCell(5)?.getChars()).toBe(""); // 넘어가며 남긴 빈 셀
    expect(row0?.translateToString(false)).toBe("  abc "); // 셀을 그대로 읽으면 빈칸이 끼었다
    expect(rt.term.buffer.active.getLine(1)?.isWrapped).toBe(true);
    rt.term.selectAll();
    const clip = fakeClipboard("");
    fireClipboard(rt, "copy", clip);
    expect(clip.written["text/plain"]).toBe(`abc${GA}${GA}\nx`);
  });

  it("nothing selected: the copy event is left alone", () => {
    rt = openRealTerm();
    const clip = fakeClipboard("");
    const event = fireClipboard(rt, "copy", clip);
    expect(clip.written["text/plain"]).toBeUndefined();
    expect(event.defaultPrevented).toBe(false);
  });

  it("Windows: CRLF line ends and the selection clears after copying", async () => {
    __setPlatformForTests("windows");
    rt = openRealTerm({ cols: 20 });
    await rt.write("  one\r\n  two\r\n");
    rt.term.selectAll();
    const clip = fakeClipboard("");
    fireClipboard(rt, "copy", clip);
    expect(clip.written["text/plain"]).toBe("one\r\ntwo");
    expect(rt.term.hasSelection()).toBe(false);
  });

  it("Windows: Ctrl+Shift+C copies by raising the copy event itself (the browser has no binding for it)", async () => {
    __setPlatformForTests("windows");
    rt = openRealTerm({ cols: 20 });
    await rt.write("  hello  \r\n");
    rt.term.selectAll();
    const clip = fakeClipboard("");
    const real = rt;
    // 브라우저의 복사 명령 흉내 — 포커스 자리에 copy 이벤트를 쏘고, 처리기가 막았으면 true.
    const exec = vi.fn((command: string) => command === "copy" && fireClipboard(real, "copy", clip).defaultPrevented);
    const before = Object.getOwnPropertyDescriptor(document, "execCommand");
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    let down: KeyboardEvent;
    try {
      down = fireKey(rt, "keydown", { key: "C", code: "KeyC", keyCode: 67, ctrlKey: true, shiftKey: true });
    } finally {
      if (before) Object.defineProperty(document, "execCommand", before);
      else delete (document as { execCommand?: unknown }).execCommand;
    }
    expect(exec).toHaveBeenCalledWith("copy");
    expect(clip.written["text/plain"]).toBe("hello");
    expect(down.defaultPrevented).toBe(true);
    expect(rt.data).toEqual([]); // PTY 로는 아무것도 — 0x03 이 나가면 인터럽트다
    expect(rt.term.hasSelection()).toBe(false);
  });

  it("Windows: when the copy command is refused, the async clipboard gets the same CRLF text", async () => {
    __setPlatformForTests("windows");
    rt = openRealTerm({ cols: 20 });
    await rt.write("  one\r\n  two\r\n");
    rt.term.selectAll();
    const writeText = vi.fn(() => Promise.resolve());
    const clipboard = navigator.clipboard;
    Object.assign(navigator, { clipboard: { ...clipboard, writeText } });
    const before = Object.getOwnPropertyDescriptor(document, "execCommand");
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    try {
      fireKey(rt, "keydown", { key: "C", code: "KeyC", keyCode: 67, ctrlKey: true, shiftKey: true });
    } finally {
      if (before) Object.defineProperty(document, "execCommand", before);
      else delete (document as { execCommand?: unknown }).execCommand;
      Object.assign(navigator, { clipboard });
    }
    expect(writeText).toHaveBeenCalledWith("one\r\ntwo");
    expect(rt.data).toEqual([]);
  });

  it("Windows: Ctrl+C without a selection is still the interrupt", () => {
    __setPlatformForTests("windows");
    rt = openRealTerm();
    fireKey(rt, "keydown", { key: "c", code: "KeyC", keyCode: 67, ctrlKey: true });
    expect(rt.data).toEqual(["\x03"]);
  });
});
