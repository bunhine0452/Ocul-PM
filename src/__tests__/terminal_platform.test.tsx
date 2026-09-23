/**
 * 터미널의 OS 갈래 — 진짜 xterm 으로 (크로스플랫폼 라운드 2026-09-23 {#ui-ime} {#ui-shortcuts}).
 *
 * xterm 은 jsdom 에서도 열린다(DOM 렌더러 + DOM 측정). 그래서 "PTY 로 무엇이
 * 나가는가" 를 `onData` 로, "앱 단축키가 들리는가" 를 window 리스너로 직접 본다 —
 * 흉내 낸 xterm 이 아니라 실제 `_keyDown`·CompositionHelper 를 지난다.
 *
 * Windows(WebView2) 한글 입력은 Chromium 의 표준 조합 모델로 재현한다:
 *   keydown(Process/229) → compositionstart → compositionupdate → input(insertCompositionText)
 *   … 음절 경계에서 compositionend → compositionstart …
 * 키 사이에는 실제처럼 태스크 경계를 둔다 — CompositionHelper 는 setTimeout(0) 으로
 * textarea 를 읽는다(한 태스크에 몰아 쏘면 실제 브라우저에 없는 순서가 된다).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { Terminal } from "@xterm/xterm";

import { __setPlatformForTests, type Platform } from "@/lib/platform";
import {
  attachTerminalInput,
  terminalFontFamily,
  terminalKeyPolicy,
  usesImeBridge,
} from "@/features/terminal/terminalPlatform";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

const OTHERS: Platform[] = ["windows", "linux"];
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

interface Rig {
  term: Terminal;
  ta: HTMLTextAreaElement;
  data: string[];
  /** window 까지 올라온 keydown (= 앱 단축키가 들을 수 있었던 것). */
  bubbled: KeyboardEvent[];
  dispose(): void;
}

function openTerminal(): Rig {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const term = new Terminal({ cols: 80, rows: 10, allowProposedApi: true });
  term.open(el);
  const handle = attachTerminalInput(term, el);
  const data: string[] = [];
  term.onData((d) => data.push(d));
  const bubbled: KeyboardEvent[] = [];
  const onWindowKey = (e: KeyboardEvent) => bubbled.push(e);
  window.addEventListener("keydown", onWindowKey);
  const ta = term.textarea!;
  ta.focus();
  return {
    term,
    ta,
    data,
    bubbled,
    dispose() {
      window.removeEventListener("keydown", onWindowKey);
      handle.dispose();
      term.dispose();
      el.remove();
    },
  };
}

function keydown(rig: Rig, init: KeyboardEventInit): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  rig.ta.dispatchEvent(ev);
  return ev;
}

const comp = (rig: Rig, type: string, data: string) =>
  rig.ta.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));

function compInput(rig: Rig, value: string, data: string) {
  rig.ta.value = value;
  rig.ta.dispatchEvent(
    new InputEvent("input", { inputType: "insertCompositionText", data, bubbles: true, isComposing: true }),
  );
}

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
  cleanup();
  vi.restoreAllMocks();
});

// ── 정책 표 ────────────────────────────────────────────────────────────────

describe("terminalKeyPolicy — what stays with the shell and what steps aside for the app", () => {
  const ev = (init: Partial<KeyboardEvent> & { key: string; code: string }) =>
    ({ type: "keydown", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...init }) as KeyboardEvent;

  const table: Array<[string, Partial<KeyboardEvent> & { key: string; code: string }, string]> = [
    ["Ctrl+C (interrupt)", { key: "c", code: "KeyC", ctrlKey: true }, "pty"],
    ["Ctrl+D (EOF)", { key: "d", code: "KeyD", ctrlKey: true }, "pty"],
    ["Ctrl+K", { key: "k", code: "KeyK", ctrlKey: true }, "pty"],
    ["Ctrl+L", { key: "l", code: "KeyL", ctrlKey: true }, "pty"],
    ["Ctrl+R", { key: "r", code: "KeyR", ctrlKey: true }, "pty"],
    ["Ctrl+U", { key: "u", code: "KeyU", ctrlKey: true }, "pty"],
    ["Ctrl+W", { key: "w", code: "KeyW", ctrlKey: true }, "pty"],
    ["Ctrl+Z", { key: "z", code: "KeyZ", ctrlKey: true }, "pty"],
    ["Ctrl+V (literal next — PSReadLine pastes by itself)", { key: "v", code: "KeyV", ctrlKey: true }, "pty"],
    ["Ctrl+[ (ESC)", { key: "[", code: "BracketLeft", ctrlKey: true }, "pty"],
    ["Ctrl+_ (readline undo)", { key: "_", code: "Minus", ctrlKey: true, shiftKey: true }, "pty"],
    ["Ctrl+Shift+C", { key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }, "copy"],
    ["Ctrl+Shift+V", { key: "V", code: "KeyV", ctrlKey: true, shiftKey: true }, "paste"],
    ["Ctrl+Shift+K (palette)", { key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }, "app"],
    ["Ctrl+Alt+Shift+D (split down)", { key: "D", code: "KeyD", ctrlKey: true, shiftKey: true, altKey: true }, "app"],
    ["Ctrl+3 (screen nav)", { key: "3", code: "Digit3", ctrlKey: true }, "app"],
    ["Ctrl+↑ (command blocks)", { key: "ArrowUp", code: "ArrowUp", ctrlKey: true }, "app"],
    ["Ctrl+Shift+Enter (zoom)", { key: "Enter", code: "Enter", ctrlKey: true, shiftKey: true }, "app"],
    ["Ctrl+Tab (tab cycling)", { key: "Tab", code: "Tab", ctrlKey: true }, "app"],
    ["Ctrl+Alt+← (shell word motion)", { key: "ArrowLeft", code: "ArrowLeft", ctrlKey: true, altKey: true }, "pty"],
    ["AltGr+Q (@ on a German layout)", { key: "@", code: "KeyQ", ctrlKey: true, altKey: true, getModifierState: (k: string) => k === "AltGraph" } as never, "pty"],
    ["plain letter", { key: "a", code: "KeyA" }, "pty"],
  ];

  it.each(table)("windows·linux: %s → %s", (_name, init, expected) => {
    for (const os of OTHERS) {
      __setPlatformForTests(os);
      expect(terminalKeyPolicy(ev(init)), os).toBe(expected);
    }
  });

  it("mac never takes this path — always pty (xterm + IME bridge untouched)", () => {
    __setPlatformForTests("mac");
    for (const [, init] of table) expect(terminalKeyPolicy(ev(init))).toBe("pty");
  });
});

describe("input path and font — mac unchanged", () => {
  it("the Hangul IME bridge is macOS-only", () => {
    __setPlatformForTests("mac");
    expect(usesImeBridge()).toBe(true);
    for (const os of OTHERS) {
      __setPlatformForTests(os);
      expect(usesImeBridge()).toBe(false);
    }
  });

  it("font stack — mac keeps the old string; elsewhere system coding fonts + D2Coding Term, no Menlo", () => {
    __setPlatformForTests("mac");
    expect(terminalFontFamily()).toBe('Menlo, "D2Coding Term", "SF Mono", ui-monospace, monospace');
    for (const os of OTHERS) {
      __setPlatformForTests(os);
      const stack = terminalFontFamily();
      expect(stack).not.toContain("Menlo");
      expect(stack).toContain('"D2Coding Term"');
      expect(stack).toContain(os === "windows" ? "Consolas" : '"DejaVu Sans Mono"');
      expect(stack.trim().endsWith("monospace")).toBe(true);
    }
  });

  it("mac: the bridge swallows composition events (xterm composition view stays off); elsewhere xterm default", () => {
    __setPlatformForTests("mac");
    rig = openTerminal();
    comp(rig, "compositionstart", "");
    expect(rig.term.element!.querySelector(".composition-view.active")).toBeNull();
    rig.dispose();
    for (const os of OTHERS) {
      __setPlatformForTests(os);
      rig = openTerminal();
      comp(rig, "compositionstart", "");
      expect(rig.term.element!.querySelector(".composition-view.active"), os).not.toBeNull();
      rig.dispose();
    }
    rig = null;
  });
});

// ── 한글 조합 (Chromium 모양) ──────────────────────────────────────────────

describe.each(OTHERS)("%s — Hangul composition reaches the PTY exactly once", (os) => {
  it("typing the word plus Enter sends the word + CR (no bare jamo, no duplicates)", async () => {
    __setPlatformForTests(os);
    rig = openTerminal();
    const r = rig;
    // ㅎ
    keydown(r, { key: "Process", keyCode: 229, code: "KeyG" });
    comp(r, "compositionstart", "");
    comp(r, "compositionupdate", "ㅎ");
    compInput(r, "ㅎ", "ㅎ");
    await tick();
    // 하
    keydown(r, { key: "Process", keyCode: 229, code: "KeyK", isComposing: true });
    comp(r, "compositionupdate", "하"); // i18n-ignore -- IME 조합 재료
    compInput(r, "하", "하"); // i18n-ignore -- IME 조합 재료
    await tick();
    // 한
    keydown(r, { key: "Process", keyCode: 229, code: "KeyS", isComposing: true });
    comp(r, "compositionupdate", "한"); // i18n-ignore -- IME 조합 재료
    compInput(r, "한", "한"); // i18n-ignore -- IME 조합 재료
    await tick();
    // ㄱ — 앞 음절 확정, 새 조합
    keydown(r, { key: "Process", keyCode: 229, code: "KeyR", isComposing: true });
    comp(r, "compositionend", "한"); // i18n-ignore -- IME 조합 재료
    comp(r, "compositionstart", "");
    comp(r, "compositionupdate", "ㄱ");
    compInput(r, "한ㄱ", "ㄱ"); // i18n-ignore -- IME 조합 재료
    await tick(10);
    // 그 → 글
    keydown(r, { key: "Process", keyCode: 229, code: "KeyM", isComposing: true });
    comp(r, "compositionupdate", "그"); // i18n-ignore -- IME 조합 재료
    compInput(r, "한그", "그"); // i18n-ignore -- IME 조합 재료
    await tick();
    keydown(r, { key: "Process", keyCode: 229, code: "KeyF", isComposing: true });
    comp(r, "compositionupdate", "글"); // i18n-ignore -- IME 조합 재료
    compInput(r, "한글", "글"); // i18n-ignore -- IME 조합 재료
    await tick();
    // Enter — 조합 확정(229) 뒤 진짜 Enter
    keydown(r, { key: "Enter", keyCode: 229, code: "Enter", isComposing: true });
    comp(r, "compositionend", "글"); // i18n-ignore -- IME 조합 재료
    await tick(10);
    keydown(r, { key: "Enter", keyCode: 13, code: "Enter" });
    await tick(10);

    expect(r.data.join("")).toBe("한글\r"); // i18n-ignore -- IME 조합 결과
    expect(r.data.filter((d) => d === "한")).toHaveLength(1); // i18n-ignore -- IME 조합 결과
    expect(r.data.filter((d) => d === "글")).toHaveLength(1); // i18n-ignore -- IME 조합 결과
    // 조합 중 낱자(ㅎ·ㄱ)는 셸로 새지 않는다.
    expect(r.data.join("")).not.toMatch(/[ㄱ-ㅎ]/);
  });
});

// ── 셸 키 양보 (진짜 xterm) ────────────────────────────────────────────────

describe.each(OTHERS)("%s — Ctrl keys inside the terminal", (os) => {
  it("Ctrl+C · Ctrl+D · Ctrl+W go to the shell as control chars and never reach the app", () => {
    __setPlatformForTests(os);
    rig = openTerminal();
    keydown(rig, { key: "c", code: "KeyC", keyCode: 67, ctrlKey: true });
    keydown(rig, { key: "d", code: "KeyD", keyCode: 68, ctrlKey: true });
    keydown(rig, { key: "w", code: "KeyW", keyCode: 87, ctrlKey: true });
    expect(rig.data).toEqual(["\x03", "\x04", "\x17"]);
    expect(rig.bubbled).toHaveLength(0);
  });

  it("Ctrl+Shift+K · Ctrl+3 · Ctrl+↑ · Ctrl+Shift+Enter skip the shell and reach the app", () => {
    __setPlatformForTests(os);
    rig = openTerminal();
    keydown(rig, { key: "K", code: "KeyK", keyCode: 75, ctrlKey: true, shiftKey: true });
    keydown(rig, { key: "3", code: "Digit3", keyCode: 51, ctrlKey: true });
    keydown(rig, { key: "ArrowUp", code: "ArrowUp", keyCode: 38, ctrlKey: true });
    keydown(rig, { key: "Enter", code: "Enter", keyCode: 13, ctrlKey: true, shiftKey: true });
    keydown(rig, { key: "D", code: "KeyD", keyCode: 68, ctrlKey: true, shiftKey: true, altKey: true });
    expect(rig.data).toEqual([]);
    expect(rig.bubbled.map((e) => e.key)).toEqual(["K", "3", "ArrowUp", "Enter", "D"]);
  });

  it("Ctrl+Tab sends no TAB and prevents the focus-moving default", () => {
    __setPlatformForTests(os);
    rig = openTerminal();
    const ev = keydown(rig, { key: "Tab", code: "Tab", keyCode: 9, ctrlKey: true });
    expect(rig.data).toEqual([]);
    expect(ev.defaultPrevented).toBe(true);
    expect(rig.bubbled).toHaveLength(1);
  });

  it("Ctrl+Shift+C copies the selection and sends no interrupt", async () => {
    __setPlatformForTests(os);
    rig = openTerminal();
    await new Promise<void>((r) => rig!.term.write("hello world", r));
    rig.term.selectAll();
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true, writable: true });
    const ev = keydown(rig, { key: "C", code: "KeyC", keyCode: 67, ctrlKey: true, shiftKey: true });
    expect(exec).toHaveBeenCalledWith("copy");
    expect(ev.defaultPrevented).toBe(true);
    expect(rig.data).toEqual([]);
  });

  it("Ctrl+Shift+V — when the native paste event arrives, only that (never twice)", async () => {
    __setPlatformForTests(os);
    rig = openTerminal();
    const readText = vi.fn(async () => "from-clipboard");
    Object.assign(navigator.clipboard, { readText });
    keydown(rig, { key: "V", code: "KeyV", keyCode: 86, ctrlKey: true, shiftKey: true });
    // Chromium 의 기본 동작 — 같은 태스크 안에 paste 가 온다.
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "via-paste" } });
    rig.ta.dispatchEvent(paste);
    await tick(10);
    expect(rig.data.join("")).toContain("via-paste");
    expect(readText).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+V — without a paste event (WebKitGTK) read the clipboard", async () => {
    __setPlatformForTests(os);
    rig = openTerminal();
    const readText = vi.fn(async () => "from-clipboard");
    Object.assign(navigator.clipboard, { readText });
    keydown(rig, { key: "V", code: "KeyV", keyCode: 86, ctrlKey: true, shiftKey: true });
    expect(rig.data).toEqual([]);
    await tick(10);
    expect(readText).toHaveBeenCalledTimes(1);
    expect(rig.data.join("")).toContain("from-clipboard");
  });
});

// ── 전역 단축키 × 진짜 xterm ────────────────────────────────────────────────

describe("global shortcuts inside the terminal — the shape of ⌘K per OS", () => {
  function mountShortcuts() {
    const onOpenPalette = vi.fn();
    const uiV2Nav = vi.fn();
    const onToggleTerminalDock = vi.fn();
    renderHook(() => useGlobalShortcuts({ onOpenPalette, uiV2Nav, onToggleTerminalDock }));
    return { onOpenPalette, uiV2Nav, onToggleTerminalDock };
  }

  it.each(OTHERS)("%s: Ctrl+K is the shell's ^K, Ctrl+Shift+K opens the palette — same for J", (os) => {
    __setPlatformForTests(os);
    rig = openTerminal();
    const s = mountShortcuts();
    keydown(rig, { key: "k", code: "KeyK", keyCode: 75, ctrlKey: true });
    expect(rig.data).toEqual(["\x0b"]);
    expect(s.onOpenPalette).not.toHaveBeenCalled();
    keydown(rig, { key: "K", code: "KeyK", keyCode: 75, ctrlKey: true, shiftKey: true });
    expect(s.onOpenPalette).toHaveBeenCalledTimes(1);
    keydown(rig, { key: "j", code: "KeyJ", keyCode: 74, ctrlKey: true });
    expect(s.onToggleTerminalDock).not.toHaveBeenCalled();
    keydown(rig, { key: "J", code: "KeyJ", keyCode: 74, ctrlKey: true, shiftKey: true });
    expect(s.onToggleTerminalDock).toHaveBeenCalledTimes(1);
    // 화면 이동은 터미널 안에서도 Ctrl+숫자 그대로.
    keydown(rig, { key: "2", code: "Digit2", keyCode: 50, ctrlKey: true });
    expect(s.uiV2Nav).toHaveBeenCalledWith("journal");
    expect(rig.data).toEqual(["\x0b", "\n"]);
  });

  it.each(OTHERS)("%s: outside the terminal Ctrl+K opens the palette", (os) => {
    __setPlatformForTests(os);
    const s = mountShortcuts();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
    expect(s.onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("mac: ⌘K opens the palette even in the terminal, ⌃K is the shell's — unchanged", () => {
    __setPlatformForTests("mac");
    rig = openTerminal();
    const s = mountShortcuts();
    keydown(rig, { key: "k", code: "KeyK", keyCode: 75, metaKey: true });
    expect(s.onOpenPalette).toHaveBeenCalledTimes(1);
    keydown(rig, { key: "k", code: "KeyK", keyCode: 75, ctrlKey: true });
    expect(rig.data).toEqual(["\x0b"]);
    expect(s.onOpenPalette).toHaveBeenCalledTimes(1);
  });
});
