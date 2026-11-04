// 터미널 이미지 경로 (11-04) — Claude Code 가 폭에서 끊고 들여 쓴 긴 경로도 하나의 링크로 잇고,
// 누르면 그 파일을 Finder 에서(경로로 이동), ⌘ 를 누른 채 누르면 크게 본다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";

const h = vi.hoisted(() => ({ preview: vi.fn(), reveal: vi.fn(async () => null) }));
vi.mock("@/api/terminal", () => ({ terminalApi: { imagePreview: h.preview, imageReveal: h.reveal } }));

import { createImagePathProvider, wrappedChain, type CellLine } from "@/features/terminal/fileLinks";
import { closePeek, peekEvent, useImagePeek } from "@/features/terminal/imagePeek";
import { renderHook } from "@testing-library/react";

afterEach(() => {
  act(() => closePeek());
  h.reveal.mockClear();
});

function fakeLine(text: string, isWrapped = false): CellLine {
  const cells: { getChars(): string; getWidth(): number }[] = [];
  for (const ch of text) {
    const wide = /[가-힣]/.test(ch); // i18n-ignore -- 넓은 글자(두 칸) 판정 정규식
    cells.push({ getChars: () => ch, getWidth: () => (wide ? 2 : 1) });
    if (wide) cells.push({ getChars: () => "", getWidth: () => 0 });
  }
  return { length: cells.length, isWrapped, getCell: (x) => cells[x] };
}

const COLS = 64;
/** 스크린숏 그대로의 모양 — 첫 줄이 폭 끝에서 `-` 로 끊기고, 다음 줄은 두 칸 들여 쓴다. */
const SCREEN = [
  "비교 캡처", // i18n-ignore -- 터미널 출력 픽스처(넓은 글자 칸 계산을 본다)
  "- 변경 전: /private/tmp/claude-501/-Users-me-web/40d26567-b8d4-", // i18n-ignore -- 터미널 출력 픽스처
  "  f327615ba652/scratchpad/before-home.png",
  "- 개발 서버가 localhost:4321에서 돌고 있어요.", // i18n-ignore -- 터미널 출력 픽스처
];
const lines = SCREEN.map((t) => fakeLine(t));
const getLine = (y: number) => lines[y];
const FULL = "/private/tmp/claude-501/-Users-me-web/40d26567-b8d4-f327615ba652/scratchpad/before-home.png";
const mouse = (extra: Partial<MouseEvent> = {}) => ({ clientX: 5, clientY: 5, ...extra }) as MouseEvent;

function linksAt(y: number) {
  const provider = createImagePathProvider(getLine, peekEvent, () => COLS);
  let out: Parameters<Parameters<typeof provider.provideLinks>[1]>[0];
  provider.provideLinks(y, (l) => (out = l));
  return out;
}

describe("wrapped image paths", () => {
  it("joins a path the TUI broke at the edge and indented on the next line", () => {
    expect(wrappedChain(getLine, 2, COLS)?.text).toContain(FULL);
    // 묶음 밖의 줄(위 · 아래 문장)은 붙지 않는다.
    expect(wrappedChain(getLine, 0, COLS)?.text).toBe(SCREEN[0]);
    expect(wrappedChain(getLine, 3, COLS)?.text).toBe(SCREEN[3]);
  });

  it("offers the same two-row link from either row", () => {
    for (const y of [2, 3]) {
      const [link] = linksAt(y)!;
      expect(link.text).toBe(FULL);
      expect(link.range.start.y).toBe(2);
      expect(link.range.end.y).toBe(3);
      expect(link.range.end.x).toBe(SCREEN[2].length);
    }
    expect(linksAt(1)).toBeUndefined();
  });

  it("does not join a short line that merely ends in a path-like word", () => {
    const short = [fakeLine("see /tmp/dir-"), fakeLine("  other.png")];
    expect(wrappedChain((y) => short[y], 0, COLS)?.text).toBe("see /tmp/dir-");
  });

  it("joins soft-wrapped rows without stripping, only when the row really filled", () => {
    const soft = [fakeLine("x /tmp/aaaa"), fakeLine("bbbb/c.png", true)];
    expect(wrappedChain((y) => soft[y], 1, 11)?.text).toBe("x /tmp/aaaabbbb/c.png");
  });

  it("a click reveals the file; a ⌘-click enlarges it", async () => {
    const [link] = linksAt(3)!;
    const { result } = renderHook(() => useImagePeek());
    await act(async () => link.activate(mouse(), link.text));
    expect(h.reveal).toHaveBeenCalledWith(FULL);
    expect(result.current).toBeNull();
    act(() => link.activate(mouse({ metaKey: true }), link.text));
    expect(result.current).toMatchObject({ path: FULL, pinned: true });
  });
});
