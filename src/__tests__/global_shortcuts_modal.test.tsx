// 모달이 열리면 전역 키는 물러난다 (11-15) — 팔레트 · 확인 창이 떠 있는 채 ⌘2 · ⌘, 가 뒤 화면을 바꿨다.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

// cmdk 가 고른 줄을 굴려 보이게 한다 — jsdom 에는 그 함수가 없다.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/api/terminal", () => ({
  terminalApi: { overview: async () => [], onSessionsChanged: async () => () => {} },
}));
vi.mock("@/api/window", () => ({
  windowApi: { attention: async () => new Map(), openProjectIds: async () => [], openProjectWindow: async () => null },
}));
vi.mock("@/api/projects", () => ({ projectsApi: { brief: async () => null } }));

import { CommandPalette } from "@/components/CommandPalette";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { t } from "@/i18n";

function shortcuts() {
  const spies = {
    onOpenPalette: vi.fn(),
    onClosePalette: vi.fn(),
    uiV2Nav: vi.fn(),
    onJumpWaiting: vi.fn(),
  };
  renderHook(() => useGlobalShortcuts(spies));
  return spies;
}

function openModal(): HTMLElement {
  const modal = document.createElement("div");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  document.body.appendChild(modal);
  return modal;
}

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, metaKey: true, ...init });

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("global shortcuts behind a modal", () => {
  it("⌘2 · ⌘, · ⌘J do nothing while an aria-modal dialog is open", () => {
    const s = shortcuts();
    const modal = openModal();
    press("2");
    press(",");
    press("j");
    expect(s.uiV2Nav).not.toHaveBeenCalled();
    expect(s.onJumpWaiting).not.toHaveBeenCalled();
    modal.remove();
    press("2");
    expect(s.uiV2Nav).toHaveBeenCalledWith("journal");
    press("j");
    expect(s.onJumpWaiting).toHaveBeenCalledTimes(1);
  });

  it("⌘K closes instead of opening while a modal is up, and opens otherwise", () => {
    const s = shortcuts();
    press("k");
    expect(s.onOpenPalette).toHaveBeenCalledTimes(1);
    openModal();
    press("k");
    expect(s.onOpenPalette).toHaveBeenCalledTimes(1);
    expect(s.onClosePalette).toHaveBeenCalledTimes(1);
  });

  it("⌃2 typed into a text field on macOS is not ⌘2", () => {
    const s = shortcuts();
    const input = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(input, { key: "2", code: "Digit2", ctrlKey: true });
    expect(s.uiV2Nav).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "2", code: "Digit2", metaKey: true });
    expect(s.uiV2Nav).toHaveBeenCalledWith("journal");
  });
});

describe("the palette is a modal dialog", () => {
  it("carries role=dialog, aria-modal and a name — so the global keys can see it", () => {
    render(<CommandPalette open onOpenChange={() => {}} onOpenSettings={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: t("palette.aria") });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
