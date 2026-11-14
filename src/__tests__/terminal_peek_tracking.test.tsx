// 마우스를 쓰는 전체 화면 위의 그림 미리보기 안내 (11-15 합류 G-06). 그 위에서는 맨 클릭이 프로그램(Claude 의
// 전체 화면 렌더러)의 것이고 수식키 누름이 Finder 다(`fileLinks` 의 clickKind). 엔진은 올림 사건에 `tracking` 을
// 실었는데 미리보기가 버려, 카드가 「누르면 Finder 에서」 라는 틀린 말을 했다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("@/api/terminal", () => ({ terminalApi: { imagePreview: h.preview } }));

import { closePeek, HOVER_DELAY_MS, peekEvent } from "@/features/terminal/imagePeek";
import { TermImagePeekHost } from "@/features/terminal/TermImagePeek";
import { t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";

afterEach(() => {
  act(() => closePeek());
  cleanup();
  vi.useRealTimers();
  h.preview.mockReset();
});

async function hoverCard(tracking: boolean): Promise<string> {
  h.preview.mockResolvedValue({ mime: "image/png", bytes: 2048, base64: "iVBORw0KGgo=" });
  vi.useFakeTimers();
  render(<TermImagePeekHost />);
  act(() => peekEvent({ kind: "hover", path: "/tmp/shots/home.png", x: 40, y: 40, ...(tracking ? { tracking } : {}) }));
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DELAY_MS);
  });
  return screen.getByRole("tooltip").querySelector(".tm-peek-hint")?.textContent ?? "";
}

describe("image peek hint over a mouse-tracking full screen", () => {
  it("says the modifier opens Finder — a plain click belongs to the program", async () => {
    const hint = await hoverCard(true);
    expect(hint).toBe(t("terminal.peek.hintTracking", { mod: "⌘" }));
    expect(hint).toContain("⌘");
    expect(hint).not.toBe(t("terminal.peek.hint", { mod: "⌘" }));
  });

  it("keeps the usual hint when nothing tracks the mouse", async () => {
    expect(await hoverCard(false)).toBe(t("terminal.peek.hint", { mod: "⌘" }));
  });

  it("Windows names Ctrl and Explorer", async () => {
    __setPlatformForTests("windows");
    const hint = await hoverCard(true);
    expect(hint).toBe(t("terminal.peek.hintTracking", { mod: "Ctrl" }));
    expect(hint).toContain("Ctrl");
  });
});
