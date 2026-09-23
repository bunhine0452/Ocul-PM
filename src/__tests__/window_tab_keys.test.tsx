/**
 * ⌘T/⌘W 와 터미널 면 단축키의 Windows·Linux 판 (크로스플랫폼 라운드 {#ui-shortcuts}).
 *
 * macOS 에서 ⌘T·⌘W 는 앱 메뉴 액셀러레이터가 받고(키다운이 오지 않는다), 터미널
 * 면의 ⌘D·⌘F 는 keydown 이 받는다. Windows·Linux 에서는:
 *   - ⌘T·⌘W 를 **키다운**으로 받는다 (`useWindowTabKeys`) — 터미널 면 안에서는
 *     Ctrl+Shift+T / Ctrl+Shift+W, 밖에서는 Ctrl+T / Ctrl+W.
 *   - 터미널 면은 늘 터미널 가족이다 — Ctrl+Shift+D 분할, Ctrl+Alt+Shift+D 아래 분할,
 *     그냥 Ctrl+D 는 셸의 EOF 라 면이 받지 않는다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { useEffect } from "react";

import { __setPlatformForTests, type Platform } from "@/lib/platform";
import { useWindowTabKeys } from "@/hooks/useWindowTabKeys";
import { useTerminalKeys, type TerminalKeyActions } from "@/features/terminal/terminalSurface/useTerminalKeys";
import { useCodeScreenKeys } from "@/features/code/codeScreen/useCodeScreenKeys";

const OTHERS: Platform[] = ["windows", "linux"];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function mountTabKeys() {
  const onNewTab = vi.fn();
  const onClose = vi.fn();
  renderHook(() => useWindowTabKeys({ onNewTab, onClose }));
  return { onNewTab, onClose };
}

function el(className: string): HTMLElement {
  const host = document.createElement("div");
  host.className = className;
  const inner = document.createElement("textarea");
  host.appendChild(inner);
  document.body.appendChild(host);
  return inner;
}

describe("useWindowTabKeys", () => {
  it("mac: listens to nothing — the menu accelerator owns it (must not open twice)", () => {
    __setPlatformForTests("mac");
    const k = mountTabKeys();
    fireEvent.keyDown(window, { key: "t", metaKey: true });
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(k.onNewTab).not.toHaveBeenCalled();
    expect(k.onClose).not.toHaveBeenCalled();
  });

  it.each(OTHERS)("%s: outside the terminal it is Ctrl+T / Ctrl+W", (os) => {
    __setPlatformForTests(os);
    const k = mountTabKeys();
    const target = el("journal");
    fireEvent.keyDown(target, { key: "t", code: "KeyT", ctrlKey: true });
    fireEvent.keyDown(target, { key: "w", code: "KeyW", ctrlKey: true });
    expect(k.onNewTab).toHaveBeenCalledTimes(1);
    expect(k.onClose).toHaveBeenCalledTimes(1);
    // ⇧ 가 붙으면 다른 키다 (편집기의 닫은 탭 되살리기 · 창 닫기).
    fireEvent.keyDown(target, { key: "T", code: "KeyT", ctrlKey: true, shiftKey: true });
    expect(k.onNewTab).toHaveBeenCalledTimes(1);
  });

  it.each(OTHERS)("%s: Ctrl+W inside the terminal is the shell's word-erase — closes nothing", (os) => {
    __setPlatformForTests(os);
    const k = mountTabKeys();
    const xterm = el("xterm");
    fireEvent.keyDown(xterm, { key: "w", code: "KeyW", ctrlKey: true });
    fireEvent.keyDown(xterm, { key: "t", code: "KeyT", ctrlKey: true });
    expect(k.onClose).not.toHaveBeenCalled();
    expect(k.onNewTab).not.toHaveBeenCalled();
    fireEvent.keyDown(xterm, { key: "W", code: "KeyW", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(xterm, { key: "T", code: "KeyT", ctrlKey: true, shiftKey: true });
    expect(k.onClose).toHaveBeenCalledTimes(1);
    expect(k.onNewTab).toHaveBeenCalledTimes(1);
  });

  it.each(OTHERS)("%s: terminal chrome (outside xterm) uses the same family — hints must not depend on focus", (os) => {
    __setPlatformForTests(os);
    const k = mountTabKeys();
    const chrome = el("term-wrap");
    fireEvent.keyDown(chrome, { key: "W", code: "KeyW", ctrlKey: true, shiftKey: true });
    expect(k.onClose).toHaveBeenCalledTimes(1);
  });
});

function actions(): TerminalKeyActions {
  return {
    addTab: vi.fn(),
    closeFocusedPane: vi.fn(),
    splitFocused: vi.fn(),
    openSearch: vi.fn(),
    closeSearch: vi.fn(),
    clearScreen: vi.fn(),
    gotoBlock: vi.fn(),
    fontDelta: vi.fn(),
    fontReset: vi.fn(),
    toggleZoom: vi.fn(),
    searchOpen: false,
    keyboardScope: "always",
    ownsNewTab: false,
  };
}

/** 보이는 터미널 면 (jsdom 의 getClientRects 는 늘 비어 있다 — 채워 준다). */
function Surface({ a }: { a: TerminalKeyActions }) {
  const rootRef = useTerminalKeys(a);
  useEffect(() => {
    if (rootRef.current) rootRef.current.getClientRects = (() => [{}]) as never;
  }, [rootRef]);
  return <div ref={rootRef} className="term-wrap" />;
}

describe("useTerminalKeys — the terminal family", () => {
  it("mac: unchanged — ⌘D row, ⇧⌘D column, ⌘F search, ⌘L clear", () => {
    __setPlatformForTests("mac");
    const a = actions();
    render(<Surface a={a} />);
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    fireEvent.keyDown(window, { key: "d", metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    fireEvent.keyDown(window, { key: "l", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowUp", metaKey: true });
    expect(a.splitFocused).toHaveBeenNthCalledWith(1, "row");
    expect(a.splitFocused).toHaveBeenNthCalledWith(2, "col");
    expect(a.openSearch).toHaveBeenCalledTimes(1);
    expect(a.clearScreen).toHaveBeenCalledTimes(1);
    expect(a.gotoBlock).toHaveBeenCalledWith("prev");
  });

  it.each(OTHERS)("%s: Ctrl+D/F/L belong to the shell — the surface ignores them", (os) => {
    __setPlatformForTests(os);
    const a = actions();
    render(<Surface a={a} />);
    fireEvent.keyDown(window, { key: "d", code: "KeyD", ctrlKey: true });
    fireEvent.keyDown(window, { key: "f", code: "KeyF", ctrlKey: true });
    fireEvent.keyDown(window, { key: "l", code: "KeyL", ctrlKey: true });
    expect(a.splitFocused).not.toHaveBeenCalled();
    expect(a.openSearch).not.toHaveBeenCalled();
    expect(a.clearScreen).not.toHaveBeenCalled();
  });

  it.each(OTHERS)("%s: Ctrl+Shift+D row · Ctrl+Alt+Shift+D column · Ctrl+Shift+F · Ctrl+Shift+L · Ctrl+↑", (os) => {
    __setPlatformForTests(os);
    const a = actions();
    render(<Surface a={a} />);
    fireEvent.keyDown(window, { key: "D", code: "KeyD", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "D", code: "KeyD", ctrlKey: true, shiftKey: true, altKey: true });
    fireEvent.keyDown(window, { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "L", code: "KeyL", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "ArrowUp", code: "ArrowUp", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Enter", code: "Enter", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: ")", code: "Digit0", ctrlKey: true, shiftKey: true });
    expect(a.splitFocused).toHaveBeenNthCalledWith(1, "row");
    expect(a.splitFocused).toHaveBeenNthCalledWith(2, "col");
    expect(a.openSearch).toHaveBeenCalledTimes(1);
    expect(a.clearScreen).toHaveBeenCalledTimes(1);
    expect(a.gotoBlock).toHaveBeenCalledWith("prev");
    expect(a.toggleZoom).toHaveBeenCalledTimes(1);
    expect(a.fontReset).toHaveBeenCalledTimes(1);
  });

  it.each(OTHERS)("%s: the Win/Super key (metaKey) is not the modifier", (os) => {
    __setPlatformForTests(os);
    const a = actions();
    render(<Surface a={a} />);
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(a.splitFocused).not.toHaveBeenCalled();
  });
});

describe("screens behind the dock do not eat terminal-family keys", () => {
  function mountCodeKeys() {
    const fns = {
      isVisible: () => true,
      tabsRef: { current: { tabs: [], focused: null } as never },
      setTabs: vi.fn(),
      quickOpenFilesRef: { current: [] },
      setQuickOpen: vi.fn(),
      openGoto: vi.fn(),
      toggleWordWrap: vi.fn(),
      toggleSidebar: vi.fn(),
      reopenClosedTab: vi.fn(),
      openSearch: vi.fn(),
      pasteHere: vi.fn(),
      cutFrom: vi.fn(),
      startCreate: vi.fn(),
    };
    renderHook(() => useCodeScreenKeys(fns));
    return fns;
  }

  it.each(OTHERS)("%s: Ctrl+Shift+F / Ctrl+Shift+T from the terminal go to the terminal, not the editor", (os) => {
    __setPlatformForTests(os);
    const c = mountCodeKeys();
    for (const cls of ["xterm", "term-wrap"]) {
      const target = el(cls);
      fireEvent.keyDown(target, { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(target, { key: "T", code: "KeyT", ctrlKey: true, shiftKey: true });
    }
    expect(c.openSearch).not.toHaveBeenCalled();
    expect(c.reopenClosedTab).not.toHaveBeenCalled();
    // the editor still gets them from anywhere else.
    fireEvent.keyDown(el("code"), { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    expect(c.openSearch).toHaveBeenCalledTimes(1);
  });

  it("mac: unchanged — ⇧⌘F reaches the editor wherever focus is", () => {
    __setPlatformForTests("mac");
    const c = mountCodeKeys();
    fireEvent.keyDown(el("term-wrap"), { key: "f", code: "KeyF", metaKey: true, shiftKey: true });
    expect(c.openSearch).toHaveBeenCalledTimes(1);
  });
});
