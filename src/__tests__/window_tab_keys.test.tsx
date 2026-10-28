/**
 * ⌘T/⌘W 의 Windows·Linux 판 (크로스플랫폼 라운드 {#ui-shortcuts}). 터미널 면 단축키는 터미널과 함께 걷었다 (2026-10-28).
 *
 * macOS 에서 ⌘T·⌘W 는 앱 메뉴 액셀러레이터가 받고(키다운이 오지 않는다), 터미널
 * 면의 ⌘D·⌘F 는 keydown 이 받는다. Windows·Linux 에서는:
 *   - ⌘T·⌘W 를 **키다운**으로 받는다 (`useWindowTabKeys`) — 터미널 면 안에서는
 *     Ctrl+Shift+T / Ctrl+Shift+W, 밖에서는 Ctrl+T / Ctrl+W.
 *   - 터미널 면은 늘 터미널 가족이다 — Ctrl+Shift+D 분할, Ctrl+Alt+Shift+D 아래 분할,
 *     그냥 Ctrl+D 는 셸의 EOF 라 면이 받지 않는다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderHook } from "@testing-library/react";

import { __setPlatformForTests, type Platform } from "@/lib/platform";
import { useWindowTabKeys } from "@/hooks/useWindowTabKeys";

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

});

/**
 * 새 창 ({#os-new-window}) — macOS 는 앱 메뉴의 ⇧⌘N, Windows·Linux 는 이 훅이
 * Ctrl+Shift+N 을 **캡처 단계**에서 받는다. 화면의 ⌘N(새 일지·검색 지우기·새 프로젝트)
 * 핸들러는 Shift 를 보지 않으므로, 먼저 받아 멈추지 않으면 그쪽이 같은 키를 먹는다.
 */
describe("useWindowTabKeys — new window", () => {
  function mountWithNewWindow() {
    const onNewTab = vi.fn();
    const onClose = vi.fn();
    const onNewWindow = vi.fn();
    renderHook(() => useWindowTabKeys({ onNewTab, onClose, onNewWindow }));
    return { onNewTab, onClose, onNewWindow };
  }

  it("mac: nothing — the menu accelerator owns ⇧⌘N (must not open two windows)", () => {
    __setPlatformForTests("mac");
    const k = mountWithNewWindow();
    fireEvent.keyDown(el("journal"), { key: "N", code: "KeyN", metaKey: true, shiftKey: true });
    fireEvent.keyDown(el("journal"), { key: "N", code: "KeyN", ctrlKey: true, shiftKey: true });
    expect(k.onNewWindow).not.toHaveBeenCalled();
  });

  it.each(OTHERS)("%s: Ctrl+Shift+N on a screen, inside xterm and on the terminal chrome", (os) => {
    __setPlatformForTests(os);
    const k = mountWithNewWindow();
    for (const cls of ["journal", "xterm", "term-wrap"]) {
      fireEvent.keyDown(el(cls), { key: "N", code: "KeyN", ctrlKey: true, shiftKey: true });
    }
    expect(k.onNewWindow).toHaveBeenCalledTimes(3);
    expect(k.onNewTab).not.toHaveBeenCalled();
    expect(k.onClose).not.toHaveBeenCalled();
  });

  it.each(OTHERS)("%s: Ctrl+N and Ctrl+Alt+Shift+N are not it", (os) => {
    __setPlatformForTests(os);
    const k = mountWithNewWindow();
    fireEvent.keyDown(el("journal"), { key: "n", code: "KeyN", ctrlKey: true });
    fireEvent.keyDown(el("xterm"), { key: "n", code: "KeyN", ctrlKey: true });
    fireEvent.keyDown(el("journal"), { key: "N", code: "KeyN", ctrlKey: true, altKey: true, shiftKey: true });
    expect(k.onNewWindow).not.toHaveBeenCalled();
  });

  it.each(OTHERS)("%s: screen ⌘N handlers (bubble phase) never see it; a held key opens one window", (os) => {
    __setPlatformForTests(os);
    const k = mountWithNewWindow();
    const screenKey = vi.fn();
    const onScreen = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "n") screenKey();
    };
    window.addEventListener("keydown", onScreen);
    try {
      const target = el("journal");
      fireEvent.keyDown(target, { key: "N", code: "KeyN", ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(target, { key: "N", code: "KeyN", ctrlKey: true, shiftKey: true, repeat: true });
      expect(k.onNewWindow).toHaveBeenCalledTimes(1);
      expect(screenKey).not.toHaveBeenCalled();
      // plain Ctrl+N still reaches the screen.
      fireEvent.keyDown(target, { key: "n", code: "KeyN", ctrlKey: true });
      expect(screenKey).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", onScreen);
    }
  });
});
